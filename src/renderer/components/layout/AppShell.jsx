import React from 'react';
import PropTypes from 'prop-types';

/**
 * AppShell - Consistent layout wrapper for application content
 * Matches the layout structure used in App.js
 *
 * @param {ReactNode} header - Header component (typically NavigationBar)
 * @param {ReactNode} subheader - Optional subheader component
 * @param {ReactNode} footer - Optional footer component
 * @param {ReactNode} children - Main content (phases)
 */
export default function AppShell({ header, subheader, footer, children }) {
  return (
    <div className="page-shell app-surface flex h-screen flex-col overflow-hidden">
      {header}
      <main
        id="main-content"
        className="flex-1 flex flex-col min-h-0 pt-[var(--app-nav-height)] overflow-y-auto overflow-x-hidden modern-scrollbar"
      >
        {subheader}
        {children}
      </main>
      {footer}
    </div>
  );
}

AppShell.propTypes = {
  header: PropTypes.node,
  subheader: PropTypes.node,
  footer: PropTypes.node,
  children: PropTypes.node
};
