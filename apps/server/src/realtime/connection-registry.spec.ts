import { ConnectionRegistry } from './connection-registry.js';

describe('ConnectionRegistry', () => {
  it('bind returns no previousSocketId for a first bind', () => {
    const reg = new ConnectionRegistry();
    expect(reg.bind('u1', 's1', 'sess1')).toEqual({});
    expect(reg.current('u1')).toEqual({ socketId: 's1', sessionId: 'sess1' });
  });

  it('a second bind replaces the binding and reports the previous socket', () => {
    const reg = new ConnectionRegistry();
    reg.bind('u1', 's1', 'sess1');
    expect(reg.bind('u1', 's2', 'sess2')).toEqual({ previousSocketId: 's1' });
    expect(reg.current('u1')).toEqual({ socketId: 's2', sessionId: 'sess2' });
  });

  it('isCurrent is true only for the latest sessionId', () => {
    const reg = new ConnectionRegistry();
    reg.bind('u1', 's1', 'sess1');
    expect(reg.isCurrent('u1', 'sess1')).toBe(true);
    reg.bind('u1', 's2', 'sess2');
    expect(reg.isCurrent('u1', 'sess1')).toBe(false);
    expect(reg.isCurrent('u1', 'sess2')).toBe(true);
    expect(reg.isCurrent('nobody', 'sess2')).toBe(false);
  });

  it('unbind with the current socket removes the entry and returns true', () => {
    const reg = new ConnectionRegistry();
    reg.bind('u1', 's1', 'sess1');
    expect(reg.unbind('u1', 's1')).toBe(true);
    expect(reg.current('u1')).toBeUndefined();
    expect(reg.size).toBe(0);
  });

  it('unbind with an old socket does not remove the newer binding', () => {
    const reg = new ConnectionRegistry();
    reg.bind('u1', 's1', 'sess1');
    reg.bind('u1', 's2', 'sess2');
    expect(reg.unbind('u1', 's1')).toBe(false);
    expect(reg.current('u1')).toEqual({ socketId: 's2', sessionId: 'sess2' });
    expect(reg.size).toBe(1);
  });

  it('unbind for an unknown user returns false and leaves no entry', () => {
    const reg = new ConnectionRegistry();
    expect(reg.unbind('ghost', 's1')).toBe(false);
    expect(reg.size).toBe(0);
  });

  it('leaves no entries behind after every user leaves', () => {
    const reg = new ConnectionRegistry();
    for (let i = 0; i < 50; i++) reg.bind(`u${i}`, `s${i}`, `sess${i}`);
    for (let i = 0; i < 50; i++) expect(reg.unbind(`u${i}`, `s${i}`)).toBe(true);
    expect(reg.size).toBe(0);
  });
});
