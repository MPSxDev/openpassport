import { expect, assert } from "chai";
import { ethers } from "hardhat";
// import { describe } from "mocha";
import { mockPassportData_sha256WithRSASSAPSS_65537, mockPassportData_sha1WithRSAEncryption_65537, mockPassportData_sha256WithRSAEncryption_65537 } from "../../common/src/utils/mockPassportData";
import { countryCodes, PASSPORT_ATTESTATION_ID, SignatureAlgorithm } from "../../common/src/constants/constants";
import { formatRoot } from "../../common/src/utils/utils";
import { groth16 } from 'snarkjs'
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { generateCircuitInputsRegister, generateCircuitInputsDisclose } from "../../common/src/utils/generateInputs";
import { formatCallData_disclose, formatCallData_register } from "../../common/src/utils/formatCallData";
import fs from 'fs';
import { LeanIMT } from "@zk-kit/lean-imt";
import { poseidon2 } from "poseidon-lite";
import { Signer } from "ethers";

type RegisterCircuitArtifacts = {
    [key: string]: {
        wasm: string,
        zkey: string,
        vkey: string,
        verifier?: any,
        inputs?: any,
        parsedCallData?: any,
        formattedCallData?: any
    }
}

describe("Proof of Passport - Contracts - Register & Disclose flow", function () {
    this.timeout(0);

    let proof, publicSignals

    const register_circuits: RegisterCircuitArtifacts = {
        sha256WithRSAEncryption_65537: {
            wasm: "../circuits/build/register_sha256WithRSAEncryption_65537_js/register_sha256WithRSAEncryption_65537.wasm",
            zkey: "../circuits/build/register_sha256WithRSAEncryption_65537_final.zkey",
            vkey: "../circuits/build/register_sha256WithRSAEncryption_65537_vkey.json"
        },
        sha1WithRSAEncryption_65537: {
            wasm: "../circuits/build/register_sha1WithRSAEncryption_65537_js/register_sha1WithRSAEncryption_65537.wasm",
            zkey: "../circuits/build/register_sha1WithRSAEncryption_65537_final.zkey",
            vkey: "../circuits/build/register_sha1WithRSAEncryption_65537_vkey.json"
        },
        sha256WithRSASSAPSS_65537: {
            wasm: "../circuits/build/register_sha256WithRSASSAPSS_65537_js/register_sha256WithRSASSAPSS_65537.wasm",
            zkey: "../circuits/build/register_sha256WithRSASSAPSS_65537_final.zkey",
            vkey: "../circuits/build/register_sha256WithRSASSAPSS_65537_vkey.json"
        }
    }

    const path_disclose_wasm = "../circuits/build/disclose_js/disclose.wasm";
    const path_disclose_zkey = "../circuits/build/disclose_final.zkey";
    const path_disclose_vkey = "../circuits/build/disclose_vkey.json";

    // Smart contracts
    let registry: any, formatter: any, register: any, verifier_disclose: any, sbt: any, poseidonT3: any
    let owner, otherAccount, thirdAccount: Signer;
    let imt: LeanIMT;

    let bitmap, scope, user_address, majority, input_disclose: any;
    let proof_disclose, publicSignals_disclose, proof_result_disclose, vkey_disclose, verified_disclose: any, rawCallData_disclose, parsedCallData_disclose: any[], formattedCallData_disclose: any;
    let secret: string = BigInt(0).toString();
    let attestation_id: string = PASSPORT_ATTESTATION_ID;

    before(
        async function generateProof() {
            [owner, otherAccount, thirdAccount] = await ethers.getSigners() as any[];
            // Set the next block timestamp to the current computer's timestamp
            const currentTimestamp = Math.floor(Date.now() / 1000) + 10;
            await ethers.provider.send('evm_setNextBlockTimestamp', [currentTimestamp]);
            await ethers.provider.send('evm_mine', []); // Mine a new block for the timestamp to take effect

            register_circuits.sha256WithRSAEncryption_65537.inputs = generateCircuitInputsRegister(
                secret,
                attestation_id,
                mockPassportData_sha256WithRSAEncryption_65537,
            );

            register_circuits.sha1WithRSAEncryption_65537.inputs = generateCircuitInputsRegister(
                secret,
                attestation_id,
                mockPassportData_sha1WithRSAEncryption_65537,
            );

            register_circuits.sha256WithRSASSAPSS_65537.inputs = generateCircuitInputsRegister(
                secret,
                attestation_id,
                mockPassportData_sha256WithRSASSAPSS_65537,
            );

            /*** Deploy contracts ***/
            await deployContracts();

            /*** Initialize merkle tree ***/
            imt = new LeanIMT((a: bigint, b: bigint) => poseidon2([a, b]), []);
        }
    );

    async function deployContracts(network = 'hardhat') {
        console.log(`Deploying contracts on ${network}...`);

        // Network-specific configurations can be added here
        let deployOptions = {};
        if (network !== 'hardhat') {
            deployOptions = {
                gasPrice: 10 * 10 ** 9,
                gasLimit: 8000000 // example gas limit
            };
        }

        const Verifier_register_sha256WithRSAEncryption_65537 = await ethers.getContractFactory("Verifier_register_sha256WithRSAEncryption_65537");
        const verifier_register_sha256WithRSAEncryption_65537 = await Verifier_register_sha256WithRSAEncryption_65537.deploy(deployOptions);
        await verifier_register_sha256WithRSAEncryption_65537.waitForDeployment();
        register_circuits.sha256WithRSAEncryption_65537.verifier = verifier_register_sha256WithRSAEncryption_65537;
        console.log('\x1b[34m%s\x1b[0m', `Verifier_register_sha256WithRSAEncryption_65537 deployed to ${verifier_register_sha256WithRSAEncryption_65537.target}`);

        const Verifier_register_sha1WithRSAEncryption_65537 = await ethers.getContractFactory("Verifier_register_sha1WithRSAEncryption_65537");
        const verifier_register_sha1WithRSAEncryption_65537 = await Verifier_register_sha1WithRSAEncryption_65537.deploy(deployOptions);
        await verifier_register_sha1WithRSAEncryption_65537.waitForDeployment();
        register_circuits.sha1WithRSAEncryption_65537.verifier = verifier_register_sha1WithRSAEncryption_65537;
        console.log('\x1b[34m%s\x1b[0m', `Verifier_register_sha1WithRSAEncryption_65537 deployed to ${verifier_register_sha1WithRSAEncryption_65537.target}`);

        const Verifier_register_sha256WithRSASSAPSS_65537 = await ethers.getContractFactory("Verifier_register_sha256WithRSASSAPSS_65537");
        const verifier_register_sha256WithRSASSAPSS_65537 = await Verifier_register_sha256WithRSASSAPSS_65537.deploy(deployOptions);
        await verifier_register_sha256WithRSASSAPSS_65537.waitForDeployment();
        register_circuits.sha256WithRSASSAPSS_65537.verifier = verifier_register_sha256WithRSASSAPSS_65537;
        console.log('\x1b[34m%s\x1b[0m', `Verifier_register_sha256WithRSASSAPSS_65537 deployed to ${verifier_register_sha256WithRSASSAPSS_65537.target}`);

        const Formatter = await ethers.getContractFactory("Formatter");
        formatter = await Formatter.deploy(deployOptions);
        await formatter.waitForDeployment();
        await formatter.addCountryCodes(Object.entries(countryCodes));
        console.log('\x1b[34m%s\x1b[0m', `Formatter deployed to ${formatter.target}`);

        const Registry = await ethers.getContractFactory("Registry");
        registry = await Registry.deploy(formatRoot(register_circuits.sha256WithRSAEncryption_65537.inputs.merkle_root), deployOptions);
        await registry.waitForDeployment();
        console.log('\x1b[34m%s\x1b[0m', `Registry deployed to ${registry.target}`);

        const PoseidonT3 = await ethers.getContractFactory("PoseidonT3");
        poseidonT3 = await PoseidonT3.deploy(deployOptions);
        await poseidonT3.waitForDeployment();
        console.log('\x1b[34m%s\x1b[0m', `PoseidonT3 deployed to: ${poseidonT3.target}`);

        const poseidonT3Address = poseidonT3.target;
        const Register = await ethers.getContractFactory("ProofOfPassportRegister_dev", {
            libraries: {
                PoseidonT3: poseidonT3Address
            }
        });
        register = await Register.deploy(registry.target, deployOptions);
        await register.waitForDeployment();
        console.log('\x1b[34m%s\x1b[0m', `Register deployed to ${register.target}`);

        const Verifier_disclose = await ethers.getContractFactory("Verifier_disclose");
        verifier_disclose = await Verifier_disclose.deploy(deployOptions);
        await verifier_disclose.waitForDeployment();
        console.log('\x1b[34m%s\x1b[0m', `Verifier_disclose deployed to ${verifier_disclose.target}`);

        await register.addSignatureAlgorithm(SignatureAlgorithm["sha256WithRSAEncryption_65537"], verifier_register_sha256WithRSAEncryption_65537.target);
        await register.addSignatureAlgorithm(SignatureAlgorithm["sha1WithRSAEncryption_65537"], verifier_register_sha1WithRSAEncryption_65537.target);
        await register.addSignatureAlgorithm(SignatureAlgorithm["sha256WithRSASSAPSS_65537"], verifier_register_sha256WithRSASSAPSS_65537.target);

        const SBT = await ethers.getContractFactory("SBT");
        sbt = await SBT.deploy(
            verifier_disclose.target,
            formatter.target,
            register.target,
            deployOptions
        );
        await sbt.waitForDeployment();
        console.log('\x1b[34m%s\x1b[0m', `SBT deployed to ${sbt.target}`);
    }

    describe("Proof of Passport - Utils flow", function () {
        it("Should convert ISO dates to unix timestamps correctly", async function () {
            const unix_timestamp = await formatter.dateToUnixTimestamp("230512") // 2023 05 12
            console.log('unix_timestamp', unix_timestamp.toString());

            var date = new Date(Number(unix_timestamp) * 1000);
            console.log("date:", date.toUTCString());

            expect(date.getUTCFullYear()).to.equal(2023);
            expect(date.getUTCMonth()).to.equal(4);
            expect(date.getUTCDate()).to.equal(12);
        })
    })

    /*** Register flow ***/
    describe("Proof of Passport - Register flow", function () {
        const sigAlgNames = ['sha256WithRSAEncryption_65537', 'sha1WithRSAEncryption_65537', 'sha256WithRSASSAPSS_65537']

        before(async function () {
            await Promise.all(sigAlgNames.map(async (sigAlgName) => {
                const sigAlgArtifacts = register_circuits[sigAlgName];
                /***  Groth16 saga Register***/
                // Generate the proof
                console.log('\x1b[32m%s\x1b[0m', `Generating proof - ${sigAlgName}`);
                ({ proof, publicSignals } = await groth16.fullProve(
                    sigAlgArtifacts.inputs,
                    sigAlgArtifacts.wasm,
                    sigAlgArtifacts.zkey
                ))
                console.log('\x1b[32m%s\x1b[0m', `Proof generated - ${sigAlgName}`);
                // Verify the proof
                const vKey = JSON.parse(fs.readFileSync(sigAlgArtifacts.vkey) as unknown as string);
                const verified = await groth16.verify(
                    vKey,
                    publicSignals,
                    proof
                )
                assert(verified == true, 'Should verify')
                console.log('\x1b[32m%s\x1b[0m', `Proof verified - ${sigAlgName}`);

                const rawCallData = await groth16.exportSolidityCallData(proof, publicSignals);
                const parsedCallData = JSON.parse(`[${rawCallData}]`);
                register_circuits[sigAlgName].parsedCallData = parsedCallData
                register_circuits[sigAlgName].formattedCallData = formatCallData_register(parsedCallData)

                // Set fake commitments into the tree
                const commitments = Array.from(new Set(Array.from({ length: 3 }, () => Math.floor(Math.random() * 100000000))));
                for (const commitment of commitments) {
                    await register.devAddCommitment(commitment); // this is a dev function and will not be deployed in production
                    imt.insert(BigInt(commitment));
                }
            }));
        });

        for (const sigAlgName of sigAlgNames) {
            const sigAlgArtifacts = register_circuits[sigAlgName];
            const sigAlgIndex = SignatureAlgorithm[sigAlgName as keyof typeof SignatureAlgorithm]

            it(`Verifier contract verifies a correct proof - Register - ${sigAlgName}`, async function () {
                expect(
                    await sigAlgArtifacts.verifier.verifyProof(
                        sigAlgArtifacts.parsedCallData[0],
                        sigAlgArtifacts.parsedCallData[1],
                        sigAlgArtifacts.parsedCallData[2],
                        sigAlgArtifacts.parsedCallData[3]
                    )
                ).to.be.true;
            });

            it(`Register with a wrong proof should fail - Register - ${sigAlgName}`, async function () {
                await expect(register
                    .validateProof({ ...sigAlgArtifacts.formattedCallData, a: [0, 0] }, sigAlgIndex))
                    .to.be.revertedWith("Register__InvalidProof()")
                    .catch(error => {
                        assert(error.message.includes("Register__InvalidProof()"), "Expected revert with Register__InvalidProof(), but got another error");
                    });
            });

            it(`Register with a wrong attestation id should fail - Register - ${sigAlgName}`, async function () {
                await expect(register
                    .validateProof({ ...sigAlgArtifacts.formattedCallData, attestation_id: "10" }, sigAlgIndex))
                    .to.be.revertedWith("Register__InvalidSignatureAlgorithm()")
                    .catch(error => {
                        assert(error.message.includes("Register__InvalidSignatureAlgorithm()"), "Expected revert with Register__InvalidSignatureAlgorithm(), but got another error");
                    });
            });

            it(`Register with a wrong signature algorithm should fail - Register - ${sigAlgName}`, async function () {
                await expect(register
                    .validateProof({ ...sigAlgArtifacts.formattedCallData}, sigAlgIndex + 1))
                    .to.be.revertedWith("Register__InvalidSignatureAlgorithm()")
                    .catch(error => {
                        assert(error.message.includes("Register__InvalidSignatureAlgorithm()"), "Expected revert with Register__InvalidSignatureAlgorithm(), but got another error");
                    });
            });

            it(`Register with a wrong merkle root should fail - Register - ${sigAlgName}`, async function () {
                await expect(register
                    .validateProof({ ...sigAlgArtifacts.formattedCallData, merkle_root: 0 }, sigAlgIndex))
                    .to.be.revertedWith("Register__InvalidMerkleRoot()")
                    .catch(error => {
                        assert(error.message.includes("Register__InvalidMerkleRoot()"), "Expected revert with Register__InvalidMerkleRoot(), but got another error");
                    });
            });

            it(`Register should succeed - Register - ${sigAlgName}`, async function () {
                await expect(register
                    .validateProof(sigAlgArtifacts.formattedCallData, sigAlgIndex)).not.to.be.reverted;
                imt.insert(BigInt(sigAlgArtifacts.formattedCallData.commitment));
                /// check if the merkle root is equal to the one from the imt
                // console.log('\x1b[34m%s\x1b[0m', `IMT Merkle root of TS Object - TS: ${imt.root}`);
                // console.log('\x1b[34m%s\x1b[0m', `Merkle root of contract - TS: ${await register.getMerkleRoot()}`);
                assert.equal(await register.getMerkleRoot(), imt.root);
                console.log('\x1b[34m%s\x1b[0m', `Merkle roots from TS Object and Smart Contract are equal: ${imt.root}`);

            });

            it(`Register with the same proof should fail - Register - ${sigAlgName}`, async function () {
                await expect(register
                    .validateProof(sigAlgArtifacts.formattedCallData, sigAlgIndex))
                    .to.be.revertedWith("Register__YouAreUsingTheSameNullifierTwice()")
                    .catch(error => {
                        assert(error.message.includes("Register__YouAreUsingTheSameNullifierTwice()"), "Expected revert with Register__YouAreUsingTheSameNullifierTwice(), but got another error");
                    });
            });
        };
    });



    /*** Disclose flow ***/
    describe("Proof of Passport - Disclose flow", function () {

        //before all
        before(async function () {
            /***  Groth16 saga - Disclose***/

            // We only test with the sha256WithRSAEncryption_65537 commitment for now

            // refactor in generate inputs function
            bitmap = Array(90).fill("1");
            scope = BigInt(1).toString();
            user_address = await thirdAccount.getAddress();
            majority = ["1", "8"];
            input_disclose = generateCircuitInputsDisclose(
                register_circuits.sha256WithRSAEncryption_65537.inputs.secret,
                register_circuits.sha256WithRSAEncryption_65537.inputs.attestation_id,
                mockPassportData_sha256WithRSAEncryption_65537,
                imt as any,
                majority,
                bitmap,
                scope,
                BigInt(user_address.toString()).toString()
            );
            // Generate the proof
            console.log('\x1b[32m%s\x1b[0m', 'Generating proof - Disclose');
            try {
                proof_result_disclose = await groth16.fullProve(
                    input_disclose,
                    path_disclose_wasm,
                    path_disclose_zkey
                );
            } catch (error) {
                console.error("Error generating proof:", error);
                throw error;
            }
            proof_disclose = proof_result_disclose.proof;
            publicSignals_disclose = proof_result_disclose.publicSignals;

            console.log('\x1b[32m%s\x1b[0m', 'Proof generated - Disclose');
            // Verify the proof
            vkey_disclose = JSON.parse(fs.readFileSync(path_disclose_vkey) as unknown as string);
            verified_disclose = await groth16.verify(
                vkey_disclose,
                publicSignals_disclose,
                proof_disclose
            )
            assert(verified_disclose == true, 'Should verify')
            console.log('\x1b[32m%s\x1b[0m', 'Proof verified - Disclose');
            rawCallData_disclose = await groth16.exportSolidityCallData(proof_disclose, publicSignals_disclose);
            parsedCallData_disclose = JSON.parse(`[${rawCallData_disclose}]`);
            formattedCallData_disclose = formatCallData_disclose(parsedCallData_disclose);
            console.log('formattedCallData_disclose', formattedCallData_disclose);

        })
        it("SBT mint should fail with a wrong current date - SBT", async function () {
            await expect(sbt.mint({ ...formattedCallData_disclose, current_date: [2, 4, 0, 1, 0, 1] }))
                .to.be.revertedWith("Current date is not within the valid range")
        });
        it("SBT mint should fail with a wrong proof - SBT", async function () {
            await expect(sbt.mint({ ...formattedCallData_disclose, nullifier: 0 }))
                .to.be.revertedWith("Invalid Proof");
        });
        it("SBT mint should fail with a wrong merkle_root - SBT", async function () {
            await expect(sbt.mint({ ...formattedCallData_disclose, merkle_root: 0 }))
                .to.be.revertedWith("Invalid merkle root");
        });
        it("Verifier_disclose.sol verifies a correct proof - Disclose", async () => {
            expect(
                await verifier_disclose.verifyProof(parsedCallData_disclose[0], parsedCallData_disclose[1], parsedCallData_disclose[2], parsedCallData_disclose[3])
            ).to.be.true;
        });
        it("SBT mint should succeed - SBT", async function () {
            await expect(
                sbt.mint(formattedCallData_disclose)
            ).not.to.be.reverted;
        });
        it("URI et Expiry saga - SBT", async function () {
            const tokenURI = await sbt.tokenURI(0);
            const decodedTokenURI = Buffer.from(tokenURI.split(',')[1], 'base64').toString();
            let parsedTokenURI;
            try {
                parsedTokenURI = JSON.parse(decodedTokenURI);
            } catch (e) {
                assert(false, 'TokenURI is not a valid JSON');
            }
            // console.log('parsedTokenURI', parsedTokenURI);
            const expired = parsedTokenURI.attributes.find((attribute: any) => attribute.trait_type === 'Expired');
            expect(expired.value).to.equal('No');
            await time.increaseTo(2240161656); // 2040
            const tokenURIAfter = await sbt.tokenURI(0);
            const decodedTokenURIAfter = Buffer.from(tokenURIAfter.split(',')[1], 'base64').toString();
            const parsedTokenURIAfter = JSON.parse(decodedTokenURIAfter);
            const expiredAfter = parsedTokenURIAfter.attributes.find((attribute: any) => attribute.trait_type === 'Expired');
            expect(expiredAfter.value).to.equal('Yes');
        });

        it("SBT mint should fail with same proof twice - SBT", async function () {
            await expect(sbt.mint(formattedCallData_disclose))
                .to.be.reverted;
        });
    });
});

