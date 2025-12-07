// Minimal XML parser fallback used when fast-xml-parser is unavailable at runtime.
// This is not a full XML parser; it provides enough structure to keep text extraction functional.
class XMLParser {
  constructor() {
    // no-op; options ignored in the fallback
  }

  // Very lightweight parse: strip tags and return text in an object shape.
  parse(xmlString = '') {
    const text = String(xmlString)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return { text };
  }
}

module.exports = { XMLParser };
