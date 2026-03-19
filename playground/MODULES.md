# Playground Module Guide

This document explains how to add new modules to the Presage Playground.
It is designed to be used as context when prompting an AI to extend the playground.

## Architecture Overview

```
playground/src/
  App.tsx                    — Module registry + routing
  types.ts                   — Shared TypeScript types
  hooks/usePlayground.tsx    — Central state (provider, wallets, contracts, tx log)
  lib/
    abis.ts                  — Contract ABIs (add new ABIs here)
    constants.ts             — Test accounts, addresses, config
    predict-api.ts           — predict.fun API helpers
  components/
    Layout.tsx               — Sidebar + StatusBar + Content + TxLog
    Sidebar.tsx              — Navigation + account switcher
    StatusBar.tsx            — Connection status, block info, active account
    TxLog.tsx                — Transaction history
    modules/
      SetupModule.tsx        — Deploy contracts, show addresses
      MarketModule.tsx       — Browse predict.fun, create Presage markets
      LendModule.tsx         — Supply/withdraw USDT
      BorrowModule.tsx       — Collateral deposit, borrow, repay, release
      VaultModule.tsx        — MetaMorpho vault lifecycle
      LiquidationModule.tsx  — Price manipulation + settlement
      TimeModule.tsx         — Time warp + decay status
      DashboardModule.tsx    — Full state snapshot
```

## How to Add a New Module

### Step 1: Create the component

Create `playground/src/components/modules/MyModule.tsx`:

```tsx
import { useState } from "react";
import { parseEther, formatEther } from "ethers";
import { usePlayground } from "../../hooks/usePlayground";

export function MyModule() {
  const pg = usePlayground();

  // Access state:
  //   pg.contracts     — contract instances for active account
  //   pg.wallets       — all test wallets (owner, alice, bob, curator, allocator, treasury)
  //   pg.activeRole    — current account role string
  //   pg.addresses     — deployed contract addresses
  //   pg.markets       — array of MarketInfo
  //   pg.vaultAddress  — vault address (if deployed)
  //   pg.provider      — JsonRpcProvider for localhost:8545

  // Switch account perspective:
  //   pg.contractsFor("bob") — get contracts signed by Bob

  // Log transactions (shows in TxLog):
  //   await pg.logTx("My action", pg.activeRole, someContract.someMethod(...))

  // Time manipulation:
  //   await pg.warpTime(86400)    — advance 1 day
  //   await pg.mineBlock()        — mine a single block
  //   await pg.refreshBlock()     — update block number/timestamp

  // Vault:
  //   pg.getVaultContract()       — vault contract for active signer
  //   pg.getVaultContract("alice") — vault contract for specific role

  return (
    <div className="module">
      <h2>My Module</h2>

      <div className="guide-box">
        <h4>Guide</h4>
        <ol>
          <li>Step 1 description</li>
          <li>Step 2 description</li>
        </ol>
      </div>

      <div className="card">
        <h3>Section Title</h3>
        {/* Your interactive content */}
      </div>
    </div>
  );
}
```

### Step 2: Register the module

In `playground/src/App.tsx`, add to the `MODULES` array and `MODULE_COMPONENTS` map:

```tsx
// In MODULES array:
{ id: "mymodule", name: "My Module", icon: "🔧", description: "What it does", requiresSetup: true },

// In MODULE_COMPONENTS:
import { MyModule } from "./components/modules/MyModule";
// ...
mymodule: MyModule,
```

That's it. The sidebar, routing, and layout are handled automatically.

## Key Patterns

### Sending transactions
Always use `pg.logTx()` to send transactions. This adds them to the visible log.

```tsx
await pg.logTx("Descriptive action name", pg.activeRole,
  pg.contracts.presage.supply(marketId, amount)
);
```

### Using a different account
The playground has 6 test accounts. Use `contractsFor()` to get contract instances for a specific role:

```tsx
const bobContracts = pg.contractsFor("bob")!;
await pg.logTx("Bob borrows", "bob",
  bobContracts.presage.borrow(marketId, amount)
);
```

### Adding new ABIs
Add ABI strings to `playground/src/lib/abis.ts`. Follow the existing pattern.

### Adding new contract addresses
If a new contract is deployed in `scripts/playground-setup.ts`:
1. Add the address to the output JSON
2. Add the field to `DeployedAddresses` in `types.ts`
3. Optionally add a contract instance to `Contracts` in `types.ts` and `buildContracts()` in `usePlayground.tsx`

## CSS Classes Reference

| Class | Usage |
|---|---|
| `.module` | Top-level module wrapper |
| `.card` | Section card with border |
| `.guide-box` | Blue-tinted instructional box |
| `.form-row` | Horizontal flex row for inputs + buttons |
| `.form-grid` | 2-column grid for form fields |
| `.form-group` | Label + input pair |
| `.btn` | Default button |
| `.btn.primary` | Indigo primary action |
| `.btn.danger` | Red danger action |
| `.btn-row` | Flex row of buttons |
| `.stat-grid` | Grid of stat cards |
| `.stat` | Individual stat (`.stat-label` + `.stat-value`) |
| `.data-table` | Styled table |
| `.code-block` | Monospace code block |
| `.mono` | Monospace text |
| `.muted` | Muted text color |

## Planned Future Modules

These modules should be added as their corresponding features are built:

- **SafetyBot** — Monitor positions, trigger liquidations, show health factor heatmap
- **LiquidityBot** — Automated supply management, optimal APY routing
- **Leverage** — Solver-assisted leverage/deleverage with profit estimation
- **SafeWallet** — Test Gnosis Safe multisig flows (batch operations)
- **PriceOracle** — Detailed oracle management, adapter configuration
