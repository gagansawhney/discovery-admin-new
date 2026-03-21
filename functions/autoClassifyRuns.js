const { onSchedule } = require("firebase-functions/v2/scheduler");
const functions = require('firebase-functions');
const { externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');
const { unifiedProcessRunInternal } = require('./processClassifiedRun');

const autoClassifyLogic = async () => {
    const logs = [];
    const log = (msg, data) => {
        logger.info(msg, data);
        logs.push({ msg, data });
    };
    const logError = (msg, data) => {
        logger.error(msg, data);
        logs.push({ error: msg, data });
    };

    try {
        // 1. Process READY runs
        const snapshot = await externalDb.collection('apifyRuns')
            .where('status', '==', 'COMPLETED')
            .where('classificationStatus', '==', 'READY')
            .limit(5)
            .get();

        if (!snapshot.empty) {
            log(`Found ${snapshot.size} READY runs to classify`);
            for (const doc of snapshot.docs) {
                await processRun(doc, log, logError);
            }
        } else {
            log('No READY runs found');
        }

        // 2. Self-Healing: Check for recent COMPLETED runs that are stuck (missing classificationStatus)
        // REMOVED orderBy to avoid "FAILED_PRECONDITION: The query requires an index" error
        const stuckSnapshot = await externalDb.collection('apifyRuns')
            .where('status', '==', 'COMPLETED')
            .limit(50) // Fetch more to increase chance of finding recent ones
            .get();

        let repairedCount = 0;
        for (const doc of stuckSnapshot.docs) {
            const data = doc.data();
            // If classificationStatus is missing entirely, it's stuck.
            if (data.classificationStatus === undefined) {
                log(`Found stuck run ${doc.id} (missing status), marking as READY`);
                await doc.ref.update({ classificationStatus: 'READY' });
                repairedCount++;
            }
            // If classificationStatus is IN_PROGRESS but older than 15 minutes, it's stale/crashed.
            else if (data.classificationStatus === 'IN_PROGRESS') {
                const startedAt = data.classificationStartedAt ? new Date(data.classificationStartedAt).getTime() : 0;
                const now = Date.now();
                // 15 minutes = 15 * 60 * 1000 = 900000 ms
                if (now - startedAt > 900000) {
                    log(`Found stale IN_PROGRESS run ${doc.id} (started ${data.classificationStartedAt}), resetting to READY`);
                    await doc.ref.update({ classificationStatus: 'READY' });
                    repairedCount++;
                }
            }
        }
        if (repairedCount > 0) {
            log(`Repaired ${repairedCount} stuck runs. They will be processed in the next cycle.`);
        } else {
            log('No stuck runs found in the sample');
        }

    } catch (error) {
        logError('autoClassifyLogic error', { error: error.message });
    }
    return logs;
};

async function processRun(doc, log, logError) {
    const run = doc.data();
    const runId = run.runId || doc.id;

    if (run.classificationStatus === 'COMPLETED') return;

    await doc.ref.update({ classificationStatus: 'IN_PROGRESS', classificationStartedAt: new Date().toISOString() });

    try {
        log(`Starting unified processing for ${runId}`);
        // Stories default to Gemini 3 (Gemini 2.0 Flash in code), Posts default to GPT-5.2
        const model = run.type === 'stories' ? 'gemini' : 'gpt-5.2';
        const result = await unifiedProcessRunInternal(runId, { model });

        await doc.ref.update({
            classificationStatus: 'COMPLETED',
            classificationCompletedAt: new Date().toISOString(),
            processingStats: result
        });

        log(`Finished ${runId}`, { result });

    } catch (error) {
        logError(`Error processing ${runId}`, { error: error.message });
        await doc.ref.update({
            classificationStatus: 'FAILED',
            classificationError: error.message,
            classificationFailedAt: new Date().toISOString()
        });
    }
}

// Scheduled function
exports.scheduledClassifyRuns = onSchedule({ schedule: "every 5 minutes", timeoutSeconds: 540, secrets: ["OPENAI_API_KEY", "GEMINI_API_KEY"] }, async (event) => {
    await autoClassifyLogic();
});

// Manual HTTP function for debugging
exports.manualAutoClassify = functions.https.onRequest({ invoker: 'public', secrets: ["OPENAI_API_KEY", "GEMINI_API_KEY"] }, async (req, res) => {
    const logs = await autoClassifyLogic();
    res.json({ success: true, logs });
});
