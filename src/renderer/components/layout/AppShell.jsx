import React, { memo } from 'react';
import PropTypes from 'prop-types';

/**
 * AppShell - Consistent layout wrapper for application content
 * Matches the layout structure used in App.js
 *
 * @param {ReactNode} header - Header component (typically NavigationBar)
 * @param {ReactNode} subheader - Optional subheader component
 * @param {ReactNode} footer - Optional footer component
 * @param {ReactNode} children - Main content (phases)
 * @param {string} maxWidth - Max width class for the main content (e.g., 'max-w-7xl', 'max-w-5xl')
 * @param {string} className - Additional classes for the shell
 */
const AppShell = memo(function AppShell({
  header,
  subheader,
  footer,
  children,
  maxWidth = 'max-w-screen-2xl',
  className = ''
}) {
  return (
    <div
      className={`page-shell app-surface flex h-screen flex-col overflow-hidden bg-system-gray-50 ${className}`}
    >
      {header}
      <main
        id="main-content"
        className="flex-1 flex flex-col min-h-0 pt-[var(--app-nav-height)] overflow-y-auto overflow-x-hidden modern-scrollbar relative"
      >
        {/* Background pattern or gradient can be added here if needed globally */}

        {subheader}

        <div className={`flex-1 w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 ${maxWidth}`}>
          {children}
        </div>
      </main>
      {footer}
    </div>
  );
});

AppShell.propTypes = {
  header: PropTypes.node,
  subheader: PropTypes.node,
  footer: PropTypes.node,
  children: PropTypes.node,
  maxWidth: PropTypes.string,
  className: PropTypes.string
};

export default AppShell;
