import type { PlaygroundModule } from "../types";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TxLog } from "./TxLog";
import { TimeWidget } from "./TimeWidget";

interface Props {
  modules: PlaygroundModule[];
  activeModule: string;
  onModuleSelect: (id: string) => void;
  children: React.ReactNode;
}

export function Layout({ modules, activeModule, onModuleSelect, children }: Props) {
  return (
    <div className="layout">
      <Sidebar modules={modules} active={activeModule} onSelect={onModuleSelect} />
      <div className="main">
        <StatusBar />
        <div className="content">{children}</div>
        <TxLog />
      </div>
      <TimeWidget />
    </div>
  );
}
