use base64::Engine;
use solana_sdk::transaction::Transaction;
use std::collections::HashMap;
use std::str::FromStr;

use crate::error::AppError;

pub fn get_param<T: FromStr>(params: &HashMap<String, String>, key: &str) -> Result<T, AppError> {
    params
        .get(key)
        .ok_or_else(|| AppError::BadRequest(format!("Missing '{key}' parameter")))?
        .parse()
        .map_err(|_| AppError::BadRequest(format!("Invalid '{key}' parameter")))
}

pub fn serialize_tx(tx: &Transaction) -> Result<String, AppError> {
    let bytes = bincode::serialize(tx)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}
