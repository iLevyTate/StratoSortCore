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
    <div className="page-shell app-surface flex min-h-screen min-h-0 flex-col modern-scrollbar">
      {header}
      {/* FIX: Changed overflow-hidden to overflow-auto to allow phase content to scroll */}
      <main className="flex flex-1 min-h-0 flex-col pt-[var(--app-nav-height)] overflow-auto modern-scrollbar">
        {subheader}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="animate-fade-in h-full">{children}</div>
        </div>
      </main>
      {footer}
    </div>
  );
}

AppShell.propTypes = {
  header: PropTypes.node,
  subheader: PropTypes.node,
  footer: PropTypes.node,
  children: PropTypes.node,
};
