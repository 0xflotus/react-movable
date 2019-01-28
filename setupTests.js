const { configureToMatchImageSnapshot } = require('jest-image-snapshot');

const customConfig = { threshold: 0.05 };
const toMatchImageSnapshot = configureToMatchImageSnapshot({
  customDiffConfig: customConfig
});
expect.extend({ toMatchImageSnapshot });
