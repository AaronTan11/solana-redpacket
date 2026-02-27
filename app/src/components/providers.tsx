import { SelectedWalletAccountContextProvider } from "@solana/react";
import type { UiWallet } from "@wallet-standard/react";
import { type ReactNode, useMemo } from "react";
import { RpcContext, rpc, rpcSubscriptions } from "@/lib/rpc";

const STORAGE_KEY = "solana-redpacket:selected-wallet";

const isBrowser = typeof window !== "undefined";

const stateSync = {
  deleteSelectedWallet: () => isBrowser && localStorage.removeItem(STORAGE_KEY),
  getSelectedWallet: () => (isBrowser ? localStorage.getItem(STORAGE_KEY) : null),
  storeSelectedWallet: (key: string) =>
    isBrowser && localStorage.setItem(STORAGE_KEY, key),
};

export function Providers({ children }: { children: ReactNode }) {
  const rpcValue = useMemo(() => ({ rpc, rpcSubscriptions }), []);

  return (
    <SelectedWalletAccountContextProvider
      filterWallets={(_: UiWallet) => true}
      stateSync={stateSync}
    >
      <RpcContext.Provider value={rpcValue}>{children}</RpcContext.Provider>
    </SelectedWalletAccountContextProvider>
  );
}
