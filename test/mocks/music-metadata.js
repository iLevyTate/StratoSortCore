module.exports = {
  parseFile: jest.fn().mockResolvedValue({
    common: {
      title: 'Mock Title',
      artist: 'Mock Artist',
      album: 'Mock Album',
      year: 2025,
      genre: ['Mock Genre']
    },
    format: {
      duration: 180
    }
  })
};
