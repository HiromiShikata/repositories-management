import { run } from './hourly.js';

describe('hourly', () => {
  test('run', async () => {
    const res = await run()
    expect(res).toEqual('finished');
  });
});
