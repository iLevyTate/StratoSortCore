function normalizeText(value, options = {}) {
  if (value == null) return '';
  const {
    maxLength = 0,
    collapseWhitespace = true,
    trim = true,
    normalizeUnicode = false
  } = options;
  let text = String(value);
  if (normalizeUnicode && typeof text.normalize === 'function') {
    text = text.normalize('NFC');
  }
  // eslint-disable-next-line no-control-regex
  text = text.replace(/\u0000/g, '');
  if (collapseWhitespace) {
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\t\x0B\f\r]+/g, ' ');
    text = text.replace(/\s{2,}/g, ' ');
  }
  if (trim) text = text.trim();
  if (Number.isFinite(maxLength) && maxLength > 0 && text.length > maxLength) {
    return text.slice(0, maxLength);
  }
  return text;
}

function normalizeOptionalText(value, options = {}) {
  const normalized = normalizeText(value, options);
  return normalized ? normalized : null;
}

module.exports = {
  normalizeText,
  normalizeOptionalText
};
