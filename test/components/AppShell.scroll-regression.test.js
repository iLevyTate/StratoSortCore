/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import AppShell from '../../src/renderer/components/layout/AppShell';

describe('AppShell scroll regression guards', () => {
  test('keeps main-content as the dedicated scroll container', () => {
    render(
      <AppShell
        header={<div>HEADER</div>}
        subheader={<div>SUBHEADER</div>}
        footer={<div>FOOTER</div>}
      >
        <div>CONTENT</div>
      </AppShell>
    );

    const main = document.getElementById('main-content');
    expect(main).toBeInTheDocument();
    expect(main).toHaveClass('overflow-y-auto');
    expect(main).toHaveClass('overflow-x-hidden');
    expect(main).toHaveClass('modern-scrollbar');
    expect(main).toHaveStyle({ scrollbarGutter: 'stable both-edges' });

    expect(screen.getByText('HEADER')).toBeInTheDocument();
    expect(screen.getByText('SUBHEADER')).toBeInTheDocument();
    expect(screen.getByText('CONTENT')).toBeInTheDocument();
    expect(screen.getByText('FOOTER')).toBeInTheDocument();
  });

  test('applies explicit content container classes without breaking children rendering', () => {
    render(
      <AppShell contentClassName="custom-content-shell">
        <div>ONLY_CONTENT</div>
      </AppShell>
    );

    const content = screen.getByText('ONLY_CONTENT');
    expect(content).toBeInTheDocument();
    expect(content.parentElement).toHaveClass('custom-content-shell');
  });
});
