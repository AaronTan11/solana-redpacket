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

pub struct ClaimAction;

/// Fetch and decode a red packet from chain.
async fn fetch_red_packet(
    rpc: &RpcClient,
    creator: &Pubkey,
    id: u64,
) -> Result<program::RedPacketAccount, AppError> {
    let (red_packet_addr, _) = program::find_red_packet_pda(creator, id);
    let account = rpc
        .get_account(&red_packet_addr)
        .await
        .map_err(|_| AppError::NotFound("Red packet not found on chain".into()))?;

    program::decode_red_packet(&account.data)
}

#[async_trait]
impl Action for ClaimAction {
    fn path(&self) -> &'static str {
        "claim"
    }

    async fn metadata(
        &self,
        rpc: &RpcClient,
        _base_url: &str,
        params: HashMap<String, String>,
    ) -> Result<ActionGetResponse, AppError> {
        let creator: Pubkey = get_param(&params, "creator")?;
        let id: u64 = get_param(&params, "id")?;

        let rp = fetch_red_packet(rpc, &creator, id).await?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let status = program::get_status(&rp, now);

        let total_sol = program::lamports_to_sol(rp.total_amount);
        let remaining_sol = program::lamports_to_sol(rp.remaining_amount);

        let description = format!(
            "{total_sol} SOL red packet — {}/{} claimed, {remaining_sol} SOL remaining (devnet)",
            rp.num_claimed, rp.num_recipients
        );

        match status {
            "fully_claimed" => Ok(
                ActionGetResponse::new(ICON_URL, "Red Packet", &description, "Fully Claimed")
                    .with_error("This red packet has been fully claimed"),
            ),
            "expired" => Ok(
                ActionGetResponse::new(ICON_URL, "Red Packet", &description, "Expired")
                    .with_error("This red packet has expired"),
            ),
            _ => {
                // Active — show claim button
                let next_slot = rp.num_claimed as usize;
                let slot_amount = if next_slot < rp.amounts.len() {
                    program::lamports_to_sol(rp.amounts[next_slot])
                } else {
                    remaining_sol / (rp.num_recipients - rp.num_claimed) as f64
                };

                let label = if rp.split_mode == SPLIT_EVEN {
                    format!("Claim {slot_amount:.4} SOL")
                } else {
                    "Claim (Random Amount)".into()
                };

                Ok(ActionGetResponse::new(
                    ICON_URL,
                    "Red Packet",
                    &description,
                    &label,
                ))
            }
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

        // Fetch current state to get slot index and verify claimable
        let rp = fetch_red_packet(rpc, &creator, id).await?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let status = program::get_status(&rp, now);

        if status == "fully_claimed" {
            return Err(AppError::BadRequest("Red packet is fully claimed".into()));
        }
        if status == "expired" {
            return Err(AppError::BadRequest("Red packet has expired".into()));
        }

        let slot_index = rp.num_claimed;
        let (red_packet_addr, _) = program::find_red_packet_pda(&creator, id);
        let (vault_addr, _) = program::find_vault_pda(&creator, id);

        let data = program::build_claim_data(slot_index);

        // SOL claim: claimer, red_packet, vault (3)
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

        let claim_amount = if (slot_index as usize) < rp.amounts.len() {
            program::lamports_to_sol(rp.amounts[slot_index as usize])
        } else {
            0.0
        };

        Ok(ActionPostResponse {
            transaction,
            message: Some(format!("Claimed {claim_amount:.4} SOL from red packet!")),
            links: None,
        })
    }
}
