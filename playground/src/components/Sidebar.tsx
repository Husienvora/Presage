import { usePlayground } from "../hooks/usePlayground";
import { TEST_ACCOUNTS } from "../lib/constants";
import type { PlaygroundModule, AccountRole } from "../types";

interface Props {
  modules: PlaygroundModule[];
  active: string;
  onSelect: (id: string) => void;
}

export function Sidebar({ modules, active, onSelect }: Props) {
  const pg = usePlayground();
  const roles = Object.keys(TEST_ACCOUNTS) as AccountRole[];

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <h1>Presage</h1>
        <span className="sidebar-subtitle">Playground</span>
      </div>

      <nav className="sidebar-nav">
        {modules.map(m => {
          const disabled = m.requiresSetup && !pg.isSetup;
          return (
            <button
              key={m.id}
              className={`sidebar-item ${active === m.id ? "active" : ""} ${disabled ? "disabled" : ""}`}
              onClick={() => !disabled && onSelect(m.id)}
              title={m.description}
            >
              <span className="sidebar-icon">{m.icon}</span>
              <span className="sidebar-label">{m.name}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-accounts">
        <div className="sidebar-section-title">Active Account</div>
        {roles.map(role => (
          <button
            key={role}
            className={`account-btn ${pg.activeRole === role ? "active" : ""}`}
            onClick={() => pg.setActiveRole(role)}
          >
            <span className="account-name">{TEST_ACCOUNTS[role].name}</span>
            <span className="account-role">{TEST_ACCOUNTS[role].role}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
