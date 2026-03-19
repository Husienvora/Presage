import { useEffect, useState } from "react";
import { usePlayground } from "./hooks/usePlayground";
import { Layout } from "./components/Layout";
import { SetupModule } from "./components/modules/SetupModule";
import { MarketModule } from "./components/modules/MarketModule";
import { LendModule } from "./components/modules/LendModule";
import { BorrowModule } from "./components/modules/BorrowModule";
import { VaultModule } from "./components/modules/VaultModule";
import { LiquidationModule } from "./components/modules/LiquidationModule";
import { LeverageModule } from "./components/modules/LeverageModule";
import { TimeModule } from "./components/modules/TimeModule";
import { DashboardModule } from "./components/modules/DashboardModule";
import type { PlaygroundModule } from "./types";

export const MODULES: PlaygroundModule[] = [
  { id: "setup",       name: "Setup",       icon: "⚙",  description: "Deploy contracts & fund accounts",     requiresSetup: false },
  { id: "markets",     name: "Markets",     icon: "🏪", description: "Create markets & seed prices",         requiresSetup: true },
  { id: "lend",        name: "Lend",        icon: "💰", description: "Supply & withdraw USDT",               requiresSetup: true },
  { id: "borrow",      name: "Borrow",      icon: "🔑", description: "Deposit collateral & borrow",          requiresSetup: true },
  { id: "vault",       name: "Vault",       icon: "🏦", description: "MetaMorpho vault lifecycle",           requiresSetup: true },
  { id: "leverage",    name: "Leverage",    icon: "📈", description: "Solver-assisted leverage & deleverage", requiresSetup: true },
  { id: "liquidation", name: "Liquidation", icon: "⚡", description: "Settle unhealthy positions",           requiresSetup: true },
  { id: "time",        name: "Time Machine",icon: "⏰", description: "Fast-forward time & mine blocks",      requiresSetup: true },
  { id: "dashboard",   name: "Dashboard",   icon: "📊", description: "Full state overview",                  requiresSetup: true },
];

const MODULE_COMPONENTS: Record<string, React.FC> = {
  setup: SetupModule,
  markets: MarketModule,
  lend: LendModule,
  borrow: BorrowModule,
  vault: VaultModule,
  leverage: LeverageModule,
  liquidation: LiquidationModule,
  time: TimeModule,
  dashboard: DashboardModule,
};

export default function App() {
  const pg = usePlayground();
  const [activeModule, setActiveModule] = useState("setup");

  useEffect(() => {
    pg.connect().catch(() => {});
  }, []);

  const ActiveComponent = MODULE_COMPONENTS[activeModule] || SetupModule;

  return (
    <Layout
      modules={MODULES}
      activeModule={activeModule}
      onModuleSelect={setActiveModule}
    >
      <ActiveComponent />
    </Layout>
  );
}
