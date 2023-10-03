use ark_circom::{CircomBuilder, CircomConfig};
use ark_std::rand::thread_rng;
use color_eyre::Result;
use std::os::raw::c_int;

use ark_bn254::Bn254;
use ark_crypto_primitives::snark::SNARK;
use ark_groth16::Groth16;

use std::time::Instant;
use std::convert::TryInto;

type GrothBn = Groth16<Bn254>;

extern crate jni;
use jni::objects::{JClass, JObject, JValue, JString};
use jni::JNIEnv;

use log::Level;
use android_logger::Config;

#[no_mangle]
pub extern "C" fn Java_io_tradle_nfc_RNPassportReaderModule_callRustCode(
    env: JNIEnv,
    _: JClass,
) -> jni::sys::jstring {
    android_logger::init_once(Config::default().with_min_level(Level::Trace));
    log::warn!("log before imports");

    let current_dir = std::env::current_dir().unwrap();
    let path_str = current_dir.to_str().unwrap();
    let output = env.new_string(path_str).expect("Couldn't create java string!");
    output.into_inner()
}

#[no_mangle]
pub extern "C" fn Java_io_tradle_nfc_RNPassportReaderModule_proveRSAInRust(
    _: JNIEnv,
    _: JClass,
) -> c_int {
    fn run() -> Result<u128, Box<dyn std::error::Error>> {
        println!("log before imports");
        Ok(10)
    }
    match run() {
        Ok(elapsed_millis) => elapsed_millis as i32, // Assuming the elapsed time will fit in an i32
        Err(_) => -1, // return -1 or some other error code when there's an error
    }
}




#[no_mangle]
pub extern "C" fn Java_io_tradle_nfc_RNPassportReaderModule_provePassport(
    env: JNIEnv,
    _: JClass,
    mrz: JObject,
    reveal_bitmap: JObject,
    data_hashes: JObject,
    e_content_bytes: JObject,
    signature: JObject,
    pubkey: JObject,
    address: JString,
) -> c_int {
    
    log::warn!("formatting inputsaaaa...");
    fn run_proof(
        mrz: JObject,
        reveal_bitmap: JObject,
        data_hashes: JObject,
        e_content_bytes: JObject,
        signature: JObject,
        pubkey: JObject,
        address: JString,
        env: JNIEnv
    ) -> Result<u128, Box<dyn std::error::Error>> {
        android_logger::init_once(Config::default().with_min_level(Level::Trace));

        log::warn!("formatting inputs...");
        log::warn!("mrz_veccccccc");
        
        let mrz_vec: Vec<String> = java_arraylist_to_rust_vec(&env, mrz)?;
        let reveal_bitmap_vec: Vec<String> = java_arraylist_to_rust_vec(&env, reveal_bitmap)?;
        let data_hashes_vec: Vec<String> = java_arraylist_to_rust_vec(&env, data_hashes)?;
        let e_content_bytes_vec: Vec<String> = java_arraylist_to_rust_vec(&env, e_content_bytes)?;
        let signature_vec: Vec<String> = java_arraylist_to_rust_vec(&env, signature)?;
        let pubkey_vec: Vec<String> = java_arraylist_to_rust_vec(&env, pubkey)?;
        let address_str: String = env.get_string(address)?.into();

        log::warn!("mrz_vec {:?}", mrz_vec);
        log::warn!("reveal_bitmap_vec {:?}", reveal_bitmap_vec);
        log::warn!("data_hashes_vec {:?}", data_hashes_vec);
        log::warn!("e_content_bytes_vec {:?}", e_content_bytes_vec);
        log::warn!("signature_vec {:?}", signature_vec);
        log::warn!("pubkey_vec {:?}", pubkey_vec);
        log::warn!("address_str {:?}", address_str);
        
        log::warn!("loading circuit...");
        const MAIN_WASM: &'static [u8] = include_bytes!("../passport/passport.wasm");
        const MAIN_R1CS: &'static [u8] = include_bytes!("../passport/passport.r1cs");
        log::warn!("circuit loaded");
        
        let cfg = CircomConfig::<Bn254>::from_bytes(MAIN_WASM, MAIN_R1CS)?;

        let mut builder = CircomBuilder::new(cfg);

        mrz_vec.iter()
            .filter_map(|s| s.parse::<u128>().ok())
            .for_each(|n| builder.push_input("mrz", n));
        reveal_bitmap_vec.iter()
            .filter_map(|s| s.parse::<u128>().ok())
            .for_each(|n| builder.push_input("reveal_bitmap", n));
        data_hashes_vec.iter()
            .filter_map(|s| s.parse::<u128>().ok())
            .for_each(|n| builder.push_input("dataHashes", n));
        e_content_bytes_vec.iter()
            .filter_map(|s| s.parse::<u128>().ok())
            .for_each(|n| builder.push_input("eContentBytes", n));
        signature_vec.iter()
            .filter_map(|s| s.parse::<u128>().ok())
            .for_each(|n| builder.push_input("signature", n));
        pubkey_vec.iter()
            .filter_map(|s| s.parse::<u128>().ok())
            .for_each(|n| builder.push_input("pubkey", n));

        // create an empty instance for setting it up
        let circom = builder.setup();
        
        let mut rng = thread_rng();
        let params = GrothBn::generate_random_parameters_with_reduction(circom, &mut rng)?;
        
        let circom = builder.build()?;
        println!("circuit built");
        
        let inputs = circom.get_public_inputs().unwrap();
        
        let start1 = Instant::now();
        
        let proof = GrothBn::prove(&params, circom, &mut rng)?;
        let duration1 = start1.elapsed();
        println!("proof generated. Took: {:?}", duration1);
        
        let start2 = Instant::now();

        let pvk = GrothBn::process_vk(&params.vk).unwrap();
        
        let verified = GrothBn::verify_with_processed_vk(&pvk, &inputs, &proof)?;
        let duration2 = start2.elapsed();
        println!("proof verified. Took: {:?}", duration2);

        assert!(verified);

        Ok(duration1.as_millis())
    }

    match run_proof(
        mrz,
        reveal_bitmap,
        data_hashes,
        e_content_bytes,
        signature,
        pubkey,
        address,
        env
    ) {
        Ok(elapsed_millis) => elapsed_millis as i32, // Assuming the elapsed time will fit in an i32
        Err(_) => -1, // return -1 or some other error code when there's an error
    }
}

fn java_arraylist_to_rust_vec(env: &JNIEnv, java_list: JObject) -> Result<Vec<String>, jni::errors::Error> {
    let size = env.call_method(java_list, "size", "()I", &[])?.i()? as i32;
    let mut vec = Vec::with_capacity(size.try_into().unwrap());

    for i in 0..size {
        let java_string = env.call_method(java_list, "get", "(I)Ljava/lang/Object;", &[JValue::from(i)])?.l()?;
        let rust_string: String = env.get_string(java_string.into())?.into();
        vec.push(rust_string);
    }

    Ok(vec)
}



// -message:"BpfCoordinator"  -message:"MATCH" -message:"maximum"  -message:"exception" level:WARN