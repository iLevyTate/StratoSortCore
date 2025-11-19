import React, { useState, Suspense, lazy } from 'react';
import {
  FiHome,
  FiFolder,
  FiFolderPlus,
  FiBarChart2,
  FiSettings,
} from 'react-icons/fi';
import { LazyLoadingSpinner } from '../LoadingSkeleton';

const FilesTab = lazy(() => import('./tabs/FilesTab'));
const OrganizeTab = lazy(() => import('./tabs/OrganizeTab'));
const SmartFoldersTab = lazy(() => import('./tabs/SmartFoldersTab'));
const AnalyticsTab = lazy(() => import('./tabs/AnalyticsTab'));
const SettingsTab = lazy(() => import('./tabs/SettingsTab'));

const TABS = [
  {
    id: 'files',
    label: 'Files',
    icon: FiHome,
    component: FilesTab,
    description: 'Manage and analyze your files',
  },
  {
    id: 'organize',
    label: 'Organize',
    icon: FiFolder,
    component: OrganizeTab,
    description: 'Review and organize files',
  },
  {
    id: 'folders',
    label: 'Smart Folders',
    icon: FiFolderPlus,
    component: SmartFoldersTab,
    description: 'Configure destination folders',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: FiBarChart2,
    component: AnalyticsTab,
    description: 'View stats and insights',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: FiSettings,
    component: SettingsTab,
    description: 'Preferences and configuration',
  },
];

export default function TabContainer() {
  const [activeTab, setActiveTab] = useState('files');

  const ActiveComponent = TABS.find((tab) => tab.id === activeTab)?.component;

  // LOW PRIORITY FIX (LOW-2): Remove console.log in production
  // Debug logging removed - use React DevTools for component debugging

  return (
    <div className="h-screen flex flex-col bg-base-200" data-theme="stratosort">
      {/* Header */}
      <header className="bg-base-100 border-b border-base-300 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-xl">S</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-neutral">StratoSort</h1>
              <p className="text-sm text-neutral/60">
                AI-Powered File Organization
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-ghost gap-2">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Search
            </button>
            <div className="badge badge-success badge-sm gap-1">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Connected
            </div>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="flex items-center gap-2 bg-base-100 px-6 py-3 border-t border-base-300">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2.5 rounded-lg
                  transition-all duration-200 font-medium text-sm
                  whitespace-nowrap
                  ${
                    isActive
                      ? 'bg-primary text-white shadow-md'
                      : 'text-base-content/70 hover:bg-base-200 hover:text-base-content'
                  }
                `}
                title={tab.description}
              >
                <Icon
                  className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : ''}`}
                />
                <span className="font-medium">{tab.label}</span>
                {isActive && (
                  <div className="w-1.5 h-1.5 bg-white rounded-full ml-1" />
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Tab Content */}
      <main className="flex-1 overflow-auto bg-base-200">
        <div className="container mx-auto p-6">
          {ActiveComponent && (
            <Suspense
              fallback={
                <LazyLoadingSpinner
                  message={`Loading ${TABS.find((t) => t.id === activeTab)?.label}...`}
                />
              }
            >
              <ActiveComponent />
            </Suspense>
          )}
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="bg-base-100 border-t border-base-300 px-6 py-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <span className="text-neutral/60">
              {TABS.find((t) => t.id === activeTab)?.description}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-success rounded-full" />
              <span className="text-neutral/60">Ollama Ready</span>
            </div>
            <div className="divider divider-horizontal m-0" />
            <span className="text-neutral/60">
              v1.0.0 • Electron {process.versions.electron}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
