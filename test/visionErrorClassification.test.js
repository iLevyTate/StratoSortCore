const {
  classifyVisionError,
  isVisionDecodePressureError,
  isVisionInputDataError
} = require('../src/main/services/visionErrorClassification');

describe('visionErrorClassification', () => {
  test('treats decode-pressure hints as runtime pressure', () => {
    const message =
      'failed to process image [vision-runtime: decode failed to find a memory slot for batch of size 1024]';
    const classification = classifyVisionError(message);
    expect(classification.isDecodePressure).toBe(true);
    expect(classification.isInputData).toBe(false);
  });

  test('treats unsupported format as input-data error', () => {
    const message = 'unsupported image format';
    expect(isVisionInputDataError(message)).toBe(true);
    expect(isVisionDecodePressureError(message)).toBe(false);
  });
});
