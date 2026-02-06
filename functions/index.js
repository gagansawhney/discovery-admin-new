const { generateUploadUrl } = require('./generateUploadUrl');
const { extractFlyerInfo } = require('./extractFlyerInfo');
const { logError } = require('./logError');
const { startInstagramScraper } = require('./startInstagramScraper');
const { startInstagramStoriesScraper } = require('./startInstagramStoriesScraper');





const { manageVenues } = require('./manageVenues');
const { geocodeAddress } = require('./geocodeAddress');
const { fetchVenueDetails } = require('./fetchVenueDetails');
const { fetchEvents } = require('./fetchEvents');

const { deleteEvent } = require('./deleteEvent');
const { saveEvent } = require('./saveEvent');

const { checkVen } = require('./checkVen');
const { getApifyRunsList } = require('./getApifyRunsList');

const { addUsername } = require('./addUsername');
const { deleteUsername } = require('./deleteUsername');
const { listUsernames } = require('./listUsernames');

const { apifyWebhookHandler } = require('./apifyWebhookHandler');
// const { pollApifyRuns, manualPollApifyRuns } = require('./pollApifyRuns');
const { manualPollApifyRuns, deletePollingLog, scheduledPollApifyRuns } = require('./pollApifyRuns');
const { scheduledClassifyRuns, manualAutoClassify } = require('./autoClassifyRuns');
const { viewProcessedRuns } = require('./viewProcessedRuns');
const { getApifyRunResults, proxyInstagramImage } = require('./getApifyRunResults');
const { processInstagramPosts } = require('./processInstagramPosts');
const { deleteApifyRun } = require('./deleteApifyRun');
const { purgeUsernames } = require('./purgeUsernames');
const { scheduleScrape, processScheduledScrapes } = require('./scheduleScrape');
const { deleteSchedule } = require('./deleteSchedule');
const { classifyApifyRun } = require('./classifyApifyRun');
const { processClassifiedRun } = require('./processClassifiedRun');
const { retryClassifyItem } = require('./retryClassifyItem');
const { deleteClassificationItem } = require('./deleteClassificationItem');

module.exports = {
  generateUploadUrl,
  extractFlyerInfo,
  logError,
  startInstagramScraper,
  startInstagramStoriesScraper,

  manageVenues,
  geocodeAddress,
  fetchVenueDetails,
  fetchEvents,

  deleteEvent,
  saveEvent,

  checkVen,

  addUsername,
  deleteUsername,
  listUsernames,
  getApifyRunsList,
  apifyWebhookHandler,
  // pollApifyRuns,
  manualPollApifyRuns,
  scheduledPollApifyRuns,
  scheduledClassifyRuns,
  manualAutoClassify,
  viewProcessedRuns,
  deletePollingLog,
  getApifyRunResults,
  proxyInstagramImage,
  processInstagramPosts,
  deleteApifyRun,
  purgeUsernames,
  scheduleScrape,
  processScheduledScrapes,
  deleteSchedule,
  classifyApifyRun,
  processClassifiedRun,
  retryClassifyItem,
  deleteClassificationItem,
};