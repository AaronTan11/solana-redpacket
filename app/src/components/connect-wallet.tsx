import { useSelectedWalletAccount } from "@solana/react";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import { useConnect, uiWalletAccountsAreSame } from "@wallet-standard/react";
import { StandardConnect } from "@wallet-standard/features";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function ConnectableWalletItem({
  wallet,
  onAccountSelect,
}: {
  wallet: UiWallet;
  onAccountSelect: (account: UiWalletAccount) => void;
}) {
  const [isConnecting, connect] = useConnect(wallet);

  const handleClick = useCallback(async () => {
    try {
      const existingAccounts = [...wallet.accounts];
      const nextAccounts = await connect();
      for (const nextAccount of nextAccounts) {
        if (
          !existingAccounts.some((a) =>
            uiWalletAccountsAreSame(nextAccount, a),
          )
        ) {
          onAccountSelect(nextAccount);
          return;
        }
      }
      if (nextAccounts[0]) {
        onAccountSelect(nextAccounts[0]);
      }
    } catch {
      // User rejected or wallet error — do nothing
    }
  }, [connect, onAccountSelect, wallet.accounts]);

  return (
    <DropdownMenuItem disabled={isConnecting} onClick={handleClick}>
      {isConnecting ? "Connecting..." : wallet.name}
    </DropdownMenuItem>
  );
}

export function ConnectWallet() {
  const [selectedWalletAccount, setSelectedWalletAccount, wallets] =
    useSelectedWalletAccount();

  function handleDisconnect() {
    setSelectedWalletAccount(undefined);
  }

  if (selectedWalletAccount) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {selectedWalletAccount.address.slice(0, 4)}...
            {selectedWalletAccount.address.slice(-4)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() =>
              navigator.clipboard.writeText(selectedWalletAccount.address)
            }
          >
            Copy Address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDisconnect}>
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const connectableWallets = wallets.filter((w) =>
    w.features.includes(StandardConnect),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">Connect Wallet</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {connectableWallets.length === 0 ? (
          <DropdownMenuItem disabled>No wallets found</DropdownMenuItem>
        ) : (
          connectableWallets.map((wallet) => (
            <ConnectableWalletItem
              key={`wallet:${wallet.name}`}
              wallet={wallet}
              onAccountSelect={setSelectedWalletAccount}
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
