import React, { memo, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Select from '../ui/Select';
import { Text } from '../ui/Typography';
import { logger } from '../../../shared/logger';
import { normalizeSeparator } from '../../../shared/namingConventions';

const NamingSettings = memo(function NamingSettings({
  namingConvention,
  setNamingConvention,
  dateFormat,
  setDateFormat,
  caseConvention,
  setCaseConvention,
  separator,
  setSeparator
}) {
  const handleConventionChange = useCallback(
    (e) => setNamingConvention(e.target.value),
    [setNamingConvention]
  );
  const handleDateFormatChange = useCallback((e) => setDateFormat(e.target.value), [setDateFormat]);
  const handleCaseChange = useCallback(
    (e) => setCaseConvention(e.target.value),
    [setCaseConvention]
  );
  const handleSeparatorChange = useCallback((e) => setSeparator(e.target.value), [setSeparator]);
  const normalizedSeparator = normalizeSeparator(separator);

  // Skip saving on initial mount to avoid overwriting stored settings with prop defaults
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (typeof window === 'undefined' || !window.electronAPI?.settings?.save) return;
    window.electronAPI.settings
      .save({
        namingConvention,
        separator,
        dateFormat,
        caseConvention
      })
      .catch((err) => {
        logger.warn('[NamingSettings] Failed to persist naming preferences:', err?.message);
      });
  }, [namingConvention, separator, dateFormat, caseConvention]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <Select
        label="Convention"
        id="naming-convention"
        value={namingConvention}
        onChange={handleConventionChange}
        aria-label="Naming convention"
      >
        <option value="subject-date">subject-date</option>
        <option value="date-subject">date-subject</option>
        <option value="project-subject-date">project-subject-date</option>
        <option value="category-subject">category-subject</option>
        <option value="keep-original">keep-original</option>
      </Select>

      <Select
        label="Date format"
        id="date-format"
        value={dateFormat}
        onChange={handleDateFormatChange}
        aria-label="Date format"
      >
        <option value="YYYY-MM-DD">YYYY-MM-DD</option>
        <option value="MM-DD-YYYY">MM-DD-YYYY</option>
        <option value="DD-MM-YYYY">DD-MM-YYYY</option>
        <option value="YYYYMMDD">YYYYMMDD</option>
      </Select>

      <Select
        label="Case"
        id="case-convention"
        value={caseConvention}
        onChange={handleCaseChange}
        aria-label="Case convention"
      >
        <option value="kebab-case">kebab-case</option>
        <option value="snake_case">snake_case</option>
        <option value="camelCase">camelCase</option>
        <option value="PascalCase">PascalCase</option>
        <option value="lowercase">lowercase</option>
        <option value="UPPERCASE">UPPERCASE</option>
      </Select>

      <div>
        <Select
          label="Separator"
          id="separator"
          value={normalizedSeparator}
          onChange={handleSeparatorChange}
          aria-label="Separator character"
          aria-describedby="separator-hint"
        >
          <option value="">none (no separator)</option>
          <option value="-">- (dash)</option>
          <option value=".">. (dot)</option>
          <option value="_">_ (underscore)</option>
        </Select>
        <Text id="separator-hint" variant="tiny" className="mt-1.5 text-system-gray-500">
          Choose one: none, dash, dot, or underscore.
        </Text>
      </div>
    </div>
  );
});

NamingSettings.propTypes = {
  namingConvention: PropTypes.string.isRequired,
  setNamingConvention: PropTypes.func.isRequired,
  dateFormat: PropTypes.string.isRequired,
  setDateFormat: PropTypes.func.isRequired,
  caseConvention: PropTypes.string.isRequired,
  setCaseConvention: PropTypes.func.isRequired,
  separator: PropTypes.string.isRequired,
  setSeparator: PropTypes.func.isRequired
};

export default NamingSettings;
