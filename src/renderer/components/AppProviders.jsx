import React from 'react';
import PropTypes from 'prop-types';
import { NotificationProvider } from '../contexts/NotificationContext';
import { FloatingSearchProvider } from '../contexts/FloatingSearchContext';
import { UndoRedoProvider } from './UndoRedoSystem';

function AppProviders({ children }) {
  return (
    <NotificationProvider>
      <FloatingSearchProvider>
        <UndoRedoProvider>{children}</UndoRedoProvider>
      </FloatingSearchProvider>
    </NotificationProvider>
  );
}

AppProviders.propTypes = {
  children: PropTypes.node.isRequired
};

export default AppProviders;
