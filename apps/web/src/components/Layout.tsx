import { NavLink } from 'react-router-dom'

export function Layout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="layout">
      <nav className="nav">
        <div className="nav-inner">
          <span className="nav-logo">✈ Departarr</span>
          <NavLink to="/today" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Today
          </NavLink>
          <NavLink to="/upcoming" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Upcoming
          </NavLink>
          <NavLink to="/past" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Past
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Settings
          </NavLink>
        </div>
      </nav>
      <main className="main-content safe-bottom">
        {children}
      </main>
    </div>
  )
}
