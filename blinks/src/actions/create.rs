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

pub struct CreateAction;

#[async_trait]
impl Action for CreateAction {
    fn path(&self) -> &'static str {
        "create"
    }

    async fn metadata(
        &self,
        _rpc: &RpcClient,
        _base_url: &str,
        _params: HashMap<String, String>,
    ) -> Result<ActionGetResponse, AppError> {
        let resp = ActionGetResponse::new(
            ICON_URL,
            "Create Red Packet",
            "Create a shareable SOL red packet that friends can claim",
            "Create",
        )
        .with_links(vec![LinkedAction {
            href: "/api/actions/create?amount={amount}&recipients={recipients}&split_mode={split_mode}&expiry_hours={expiry_hours}".into(),
            label: "Create Red Packet".into(),
            parameters: Some(vec![
                ActionParameter::number("amount", "Amount (SOL)", true).with_min(0.001),
                ActionParameter::number("recipients", "Number of Recipients (1-20)", true)
                    .with_min(1.0)
                    .with_max(20.0),
                ActionParameter::radio(
                    "split_mode",
                    "Split Mode",
                    vec![
                        ActionParameterOption::new("Even", "0"),
                        ActionParameterOption::new("Random", "1"),
                    ],
                ),
                ActionParameter::number("expiry_hours", "Hours until expiry", true)
                    .with_min(1.0),
            ]),
        }]);

        Ok(resp)
    }

    async fn execute(
        &self,
        rpc: &RpcClient,
        base_url: &str,
        account: Pubkey,
        params: HashMap<String, String>,
    ) -> Result<ActionPostResponse, AppError> {
        // Parse parameters
        let amount_sol: f64 = get_param(&params, "amount")?;
        let num_recipients: u8 = get_param(&params, "recipients")?;
        let split_mode: u8 = get_param(&params, "split_mode")?;
        let expiry_hours: u64 = get_param(&params, "expiry_hours")?;

        // Validate
        if amount_sol < 0.001 {
            return Err(AppError::BadRequest("Amount must be at least 0.001 SOL".into()));
        }
        if num_recipients < 1 || num_recipients > MAX_RECIPIENTS {
            return Err(AppError::BadRequest(
                format!("Recipients must be 1-{MAX_RECIPIENTS}"),
            ));
        }
        if split_mode != SPLIT_EVEN && split_mode != SPLIT_RANDOM {
            return Err(AppError::BadRequest("Split mode must be 0 (even) or 1 (random)".into()));
        }

        let total_lamports = program::sol_to_lamports(amount_sol);
        let fee = program::compute_fee(total_lamports);
        // Generate unique ID from timestamp
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Calculate expiry
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let expires_at = now + (expiry_hours as i64) * 3600;

        // Derive PDAs
        let (red_packet, rp_bump) = program::find_red_packet_pda(&account, id);
        let (vault, vault_bump) = program::find_vault_pda(&account, id);
        let (treasury, _) = program::find_treasury_pda_sol();

        // Generate random amounts if needed
        let amounts = if split_mode == SPLIT_RANDOM {
            Some(program::generate_random_split(total_lamports, num_recipients as usize))
        } else {
            None
        };

        // Build instruction data
        let data = program::build_create_data(
            id,
            total_lamports,
            num_recipients,
            split_mode,
            expires_at,
            rp_bump,
            vault_bump,
            amounts.as_deref(),
        );

        // SOL create: creator, red_packet, vault, treasury, system_program (5)
        let ix = Instruction {
            program_id: *PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(account, true),
                AccountMeta::new(red_packet, false),
                AccountMeta::new(vault, false),
                AccountMeta::new(treasury, false),
                AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
            ],
            data,
        };

        let blockhash = rpc.get_latest_blockhash().await?;
        let msg = Message::new_with_blockhash(&[ix], Some(&account), &blockhash);
        let tx = Transaction::new_unsigned(msg);
        let transaction = serialize_tx(&tx)?;

        let amount_display = program::lamports_to_sol(total_lamports);
        let fee_display = program::lamports_to_sol(fee);
        let claim_url = format!(
            "{base_url}/api/actions/claim?creator={}&id={id}",
            account
        );

        Ok(ActionPostResponse {
            transaction,
            message: Some(format!(
                "Red packet created! {amount_display} SOL for {num_recipients} recipients (fee: {fee_display} SOL).\n\nShare this claim link:\n{claim_url}"
            )),
            links: None,
        })
    }
}
