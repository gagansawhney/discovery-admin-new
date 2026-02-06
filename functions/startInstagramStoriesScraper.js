const functions = require('firebase-functions');
const logger = require('firebase-functions/logger');
const { externalDb } = require('./firebase');
const { Buffer } = require('buffer');

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const STORIES_ACTOR_ID = 'louisdeconinck~instagram-stories-scraper';

exports.startInstagramStoriesScraper = functions.https.onRequest({ invoker: 'public', secrets: ["APIFY_API_TOKEN"], timeoutSeconds: 540 }, async (req, res) => {
	logger.info('--- startInstagramStoriesScraper: Function started ---');

	// CORS
	res.set('Access-Control-Allow-Origin', '*');
	res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	if (req.method === 'OPTIONS') {
		logger.info('--- startInstagramStoriesScraper: OPTIONS request handled ---');
		res.status(204).send('');
		return;
	}

	try {
		if (!APIFY_API_TOKEN) {
			logger.error('startInstagramStoriesScraper error: Apify API token not configured');
			res.status(500).json({ success: false, error: 'Apify API token not configured. Please contact administrator.' });
			return;
		}
		if (req.method !== 'POST') {
			res.status(405).send('Method Not Allowed');
			return;
		}

		let { instagramUsernames } = req.body;
		if (!instagramUsernames) {
			logger.info('No usernames provided; loading from venues.instagramUsernames');
			const venuesSnapshot = await externalDb.collection('venues').get();
			const usernamesSet = new Set();
			venuesSnapshot.forEach(doc => {
				const v = doc.data();
				if (Array.isArray(v.instagramUsernames)) {
					v.instagramUsernames.forEach((u) => {
						if (typeof u === 'string' && u.trim()) usernamesSet.add(u.trim());
					});
				}
			});
			const merged = Array.from(usernamesSet);
			if (merged.length === 0) {
				logger.error('startInstagramStoriesScraper error: No Instagram usernames found on venues');
				res.status(400).json({ success: false, error: 'No Instagram usernames found on venues' });
				return;
			}
			instagramUsernames = merged.join(',');
		}

		const usernamesArr = instagramUsernames.split(',').map(u => u.trim()).filter(Boolean);
		const input = { profiles: usernamesArr };

		// Webhook to update run status
		const webhookUrl = 'https://us-central1-discovery-admin-f87ce.cloudfunctions.net/apifyWebhookHandler';
		const webhookPayload = '{ "runId": "{{runId}}", "datasetId": "{{defaultDatasetId}}", "status": "{{status}}", "error": "{{errorMessage}}" }';
		const webhooks = [
			{ eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'], requestUrl: webhookUrl, payloadTemplate: webhookPayload }
		];
		const webhooksParam = Buffer.from(JSON.stringify(webhooks)).toString('base64');

		const url = `https://api.apify.com/v2/acts/${STORIES_ACTOR_ID}/runs?token=${APIFY_API_TOKEN}&webhooks=${webhooksParam}`;
		logger.info('Attempting Apify stories actor run', { actorId: STORIES_ACTOR_ID, inputPreview: { size: usernamesArr.length } });
		const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
		const bodyText = await resp.text();
		let runJson = null;
		try { runJson = JSON.parse(bodyText); } catch {}
		if (!resp.ok || !(runJson && runJson.data && runJson.data.id)) {
			logger.error('Stories actor run request failed or missing run id', { status: resp.status, body: bodyText && bodyText.slice(0, 1000) });
			res.status(500).json({ success: false, error: 'Failed to start stories actor', details: { status: resp.status, body: bodyText } });
			return;
		}

		const runId = runJson.data.id;
		const datasetId = runJson.data.defaultDatasetId;

		// Save run info with type 'stories'
		await externalDb.collection('apifyRuns').doc(runId).set({
			runId,
			datasetId,
			status: 'initiated',
			initiatedAt: new Date().toISOString(),
			instagramUsernames,
			type: 'stories',
			actorId: STORIES_ACTOR_ID,
		});

		res.status(200).json({ success: true, message: 'Stories scrape requested.', runId, actorId: STORIES_ACTOR_ID });
	} catch (error) {
		logger.error('startInstagramStoriesScraper outer error', { error: error.message, stack: error.stack });
		res.status(500).json({ success: false, error: 'Failed to start stories scraper', details: error.message });
	}
}); 