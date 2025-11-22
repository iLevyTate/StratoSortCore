import React, { memo, useCallback } from 'react';
import PropTypes from 'prop-types';
import Select from '../ui/Select';
import Input from '../ui/Input';

const NamingSettings = memo(function NamingSettings({
  namingConvention,
  setNamingConvention,
  dateFormat,
  setDateFormat,
  caseConvention,
  setCaseConvention,
  separator,
  setSeparator,
}) {
  const handleConventionChange = useCallback(
    (e) => setNamingConvention(e.target.value),
    [setNamingConvention],
  );
  const handleDateFormatChange = useCallback(
    (e) => setDateFormat(e.target.value),
    [setDateFormat],
  );
  const handleCaseChange = useCallback(
    (e) => setCaseConvention(e.target.value),
    [setCaseConvention],
  );
  const handleSeparatorChange = useCallback(
    (e) => setSeparator(e.target.value),
    [setSeparator],
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
      <div>
        <label
          htmlFor="naming-convention"
          className="block text-sm font-medium text-system-gray-700 mb-2"
        >
          Convention
        </label>
        <Select
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
      </div>
      <div>
        <label
          htmlFor="date-format"
          className="block text-sm font-medium text-system-gray-700 mb-2"
        >
          Date format
        </label>
        <Select
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
      </div>
      <div>
        <label
          htmlFor="case-convention"
          className="block text-sm font-medium text-system-gray-700 mb-2"
        >
          Case
        </label>
        <Select
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
      </div>
      <div>
        <label
          htmlFor="separator"
          className="block text-sm font-medium text-system-gray-700 mb-2"
        >
          Separator
        </label>
        <Input
          id="separator"
          value={separator}
          onChange={handleSeparatorChange}
          placeholder="-"
          aria-label="Separator character"
        />
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
  setSeparator: PropTypes.func.isRequired,
};

export default NamingSettings;
