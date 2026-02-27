import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type ClusterUrl,
} from "@solana/kit";
import { createContext } from "react";

const RPC_URL = (import.meta.env.VITE_RPC_URL || "https://api.devnet.solana.com") as ClusterUrl;
const WS_URL = (import.meta.env.VITE_WS_URL || "wss://api.devnet.solana.com") as ClusterUrl;

export const rpc = createSolanaRpc(RPC_URL);
export const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

export const RpcContext = createContext({
  rpc,
  rpcSubscriptions,
});
