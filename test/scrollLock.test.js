describe('scrollLock', () => {
  function loadModule() {
    jest.resetModules();
    return require('../src/renderer/utils/scrollLock');
  }

  test('lockAppScroll hides overflow and restores on unlock', () => {
    const main = document.createElement('div');
    main.id = 'main-content';
    document.body.appendChild(main);
    document.body.style.overflow = 'auto';
    main.style.overflow = 'scroll';

    const { lockAppScroll, unlockAppScroll } = loadModule();

    lockAppScroll();
    expect(document.body.style.overflow).toBe('hidden');
    expect(main.style.overflow).toBe('hidden');

    unlockAppScroll();
    expect(document.body.style.overflow).toBe('auto');
    expect(main.style.overflow).toBe('scroll');

    main.remove();
  });

  test('lock count prevents early unlock', () => {
    const main = document.createElement('div');
    main.id = 'main-content';
    document.body.appendChild(main);
    document.body.style.overflow = 'auto';

    const { lockAppScroll, unlockAppScroll } = loadModule();

    lockAppScroll();
    lockAppScroll();
    unlockAppScroll();
    expect(document.body.style.overflow).toBe('hidden');

    unlockAppScroll();
    expect(document.body.style.overflow).toBe('auto');

    main.remove();
  });
});
