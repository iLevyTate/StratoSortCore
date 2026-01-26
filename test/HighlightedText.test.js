/**
 * Tests for HighlightedText component - Text highlighting for search results
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import HighlightedText from '../src/renderer/components/ui/HighlightedText';

describe('HighlightedText', () => {
  describe('rendering', () => {
    test('renders text without highlights when query is empty', () => {
      render(<HighlightedText text="hello world" query="" />);
      expect(screen.getByText('hello world')).toBeInTheDocument();
    });

    test('renders null when text is empty', () => {
      const { container } = render(<HighlightedText text="" query="test" />);
      expect(container.firstChild).toBeNull();
    });

    test('renders null when text is null', () => {
      const { container } = render(<HighlightedText text={null} query="test" />);
      expect(container.firstChild).toBeNull();
    });

    test('renders null when text is undefined', () => {
      const { container } = render(<HighlightedText text={undefined} query="test" />);
      expect(container.firstChild).toBeNull();
    });

    test('renders text in default span element', () => {
      const { container } = render(<HighlightedText text="hello world" query="" />);
      const wrapper = container.firstChild;
      expect(wrapper.tagName).toBe('SPAN');
    });

    test('renders text in custom element when as prop specified', () => {
      const { container } = render(<HighlightedText text="hello" query="" as="p" />);
      const wrapper = container.firstChild;
      expect(wrapper.tagName).toBe('P');
    });

    test('applies className to container', () => {
      const { container } = render(
        <HighlightedText text="hello" query="" className="custom-class" />
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('highlighting', () => {
    test('highlights matching text with mark element', () => {
      render(<HighlightedText text="hello world" query="hello" />);
      const mark = screen.getByText('hello');
      expect(mark.tagName).toBe('MARK');
    });

    test('applies default highlight classes to mark', () => {
      render(<HighlightedText text="hello world" query="hello" />);
      const mark = screen.getByText('hello');
      expect(mark).toHaveClass('bg-stratosort-warning/15');
      expect(mark).toHaveClass('text-system-gray-900');
      expect(mark).toHaveClass('rounded-sm');
      expect(mark).toHaveClass('px-0.5');
    });

    test('applies custom highlightClassName to mark', () => {
      render(
        <HighlightedText text="hello world" query="hello" highlightClassName="custom-highlight" />
      );
      const mark = screen.getByText('hello');
      expect(mark).toHaveClass('custom-highlight');
    });

    test('renders non-matching text in span', () => {
      const { container } = render(<HighlightedText text="hello world" query="hello" />);
      // Non-matching text should be in a span (not a mark)
      const spans = container.querySelectorAll('span > span');
      expect(spans.length).toBeGreaterThan(0);
      // Check that the non-highlighted text includes 'world'
      const nonHighlightedSpan = Array.from(spans).find((s) => s.textContent.includes('world'));
      expect(nonHighlightedSpan).toBeDefined();
      expect(nonHighlightedSpan.tagName).toBe('SPAN');
    });

    test('highlights case-insensitively', () => {
      render(<HighlightedText text="Hello World" query="hello" />);
      const mark = screen.getByText('Hello');
      expect(mark.tagName).toBe('MARK');
    });

    test('highlights multiple matches', () => {
      render(<HighlightedText text="hello hello" query="hello" />);
      const marks = screen.getAllByText('hello');
      expect(marks).toHaveLength(2);
      marks.forEach((mark) => expect(mark.tagName).toBe('MARK'));
    });

    test('highlights multiple different query words', () => {
      render(<HighlightedText text="the quick brown fox" query="quick fox" />);
      expect(screen.getByText('quick').tagName).toBe('MARK');
      expect(screen.getByText('fox').tagName).toBe('MARK');
    });
  });

  describe('memoization', () => {
    test('component is memoized', () => {
      // HighlightedText is wrapped in memo(), verify it's a memo component
      expect(HighlightedText.$$typeof).toBeDefined();
    });
  });
});
