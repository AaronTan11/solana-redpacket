use async_trait::async_trait;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::message::Message;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::transaction::Transaction;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use super::{get_param, serialize_tx, Action};
use crate::consts::*;
use crate::error::AppError;
use crate::program;
use crate::spec::*;

pub struct CloseAction;

#[async_trait]
impl Action for CloseAction {
    fn path(&self) -> &'static str {
        "close"
    }

    async fn metadata(
        &self,
        rpc: &RpcClient,
        _base_url: &str,
        params: HashMap<String, String>,
    ) -> Result<ActionGetResponse, AppError> {
        let creator: Pubkey = get_param(&params, "creator")?;
        let id: u64 = get_param(&params, "id")?;

        let (red_packet_addr, _) = program::find_red_packet_pda(&creator, id);
        let account = rpc
            .get_account(&red_packet_addr)
            .await
            .map_err(|_| AppError::NotFound("Red packet not found on chain".into()))?;

        let rp = program::decode_red_packet(&account.data)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let status = program::get_status(&rp, now);

        let remaining_sol = program::lamports_to_sol(rp.remaining_amount);
        let description = format!(
            "{}/{} claimed — {remaining_sol} SOL remaining",
            rp.num_claimed, rp.num_recipients
        );

        let can_close = status == "expired" || status == "fully_claimed";

        if can_close {
            Ok(ActionGetResponse::new(
                ICON_URL,
                "Close Red Packet",
                &description,
                "Close & Reclaim SOL",
            ))
        } else {
            Ok(
                ActionGetResponse::new(ICON_URL, "Close Red Packet", &description, "Close")
                    .with_error("Red packet is still active — wait for expiry or all claims"),
            )
        }
    }

    async fn execute(
        &self,
        rpc: &RpcClient,
        _base_url: &str,
        account: Pubkey,
        params: HashMap<String, String>,
    ) -> Result<ActionPostResponse, AppError> {
        let creator: Pubkey = get_param(&params, "creator")?;
        let id: u64 = get_param(&params, "id")?;

        // Verify the signer is the creator
        if account != creator {
            return Err(AppError::BadRequest(
                "Only the red packet creator can close it".into(),
            ));
        }

        // Fetch state to verify closeable
        let (red_packet_addr, _) = program::find_red_packet_pda(&creator, id);
        let rpc_account = rpc
            .get_account(&red_packet_addr)
            .await
            .map_err(|_| AppError::NotFound("Red packet not found on chain".into()))?;

        let rp = program::decode_red_packet(&rpc_account.data)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let status = program::get_status(&rp, now);

        if status == "active" {
            return Err(AppError::BadRequest(
                "Cannot close an active red packet".into(),
            ));
        }

        let (vault_addr, _) = program::find_vault_pda(&creator, id);
        let data = program::build_close_data();

        // SOL close: creator, red_packet, vault (3)
        let ix = Instruction {
            program_id: *PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(account, true),
                AccountMeta::new(red_packet_addr, false),
                AccountMeta::new(vault_addr, false),
            ],
            data,
        };

        let blockhash = rpc.get_latest_blockhash().await?;
        let msg = Message::new_with_blockhash(&[ix], Some(&account), &blockhash);
        let tx = Transaction::new_unsigned(msg);
        let transaction = serialize_tx(&tx)?;

        let remaining_sol = program::lamports_to_sol(rp.remaining_amount);

        Ok(ActionPostResponse {
            transaction,
            message: Some(format!(
                "Red packet closed. {remaining_sol} SOL reclaimed."
            )),
            links: None,
        })
    }
}
