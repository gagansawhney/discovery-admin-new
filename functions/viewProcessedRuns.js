const functions = require('firebase-functions');
const { externalDb } = require('./firebase');
const logger = require('firebase-functions/logger');

// Helper to generate HTML page
const renderPage = (title, content) => `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; color: #333; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
    th { background: #f9f9f9; font-weight: 600; }
    tr:hover { background: #f5f5f5; }
    a { color: #007bff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .img-thumb { width: 60px; height: 60px; object-fit: cover; border-radius: 4px; background: #eee; }
    .badge { padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-secondary { background: #e2e3e5; color: #383d41; }
    .back-link { display: inline-block; margin-bottom: 20px; color: #666; }
    .empty-state { text-align: center; padding: 40px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
  </div>
</body>
</html>
`;

exports.viewProcessedRuns = functions.https.onRequest({ invoker: 'public' }, async (req, res) => {
    try {
        const runId = req.query.runId;

        // 1. Detail View: Show events for a specific run
        if (runId) {
            const eventsSnapshot = await externalDb.collection('events')
                .where('source.runId', '==', runId)
                .get();

            const events = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Also fetch run details for context
            let runDate = 'Unknown Date';
            try {
                const runDoc = await externalDb.collection('apifyRuns').doc(runId).get();
                if (runDoc.exists) {
                    const d = new Date(runDoc.data().initiatedAt);
                    runDate = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
                }
            } catch (e) { }

            let htmlContent = `
        <a href="?" class="back-link">&larr; Back to Runs</a>
        <h1>Run: ${runId}</h1>
        <p><strong>Initiated:</strong> ${runDate}</p>
        <p><strong>Events Found:</strong> ${events.length}</p>
      `;

            if (events.length > 0) {
                htmlContent += `
          <table>
            <thead>
              <tr>
                <th style="width: 80px">Image</th>
                <th>Event Details</th>
                <th>Venue</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              ${events.map(event => `
                <tr>
                  <td>
                    ${event.flyerUrl ? `<a href="${event.flyerUrl}" target="_blank"><img src="${event.flyerUrl}" class="img-thumb" loading="lazy" /></a>` : '<div class="img-thumb"></div>'}
                  </td>
                  <td>
                    <div style="font-weight: bold; margin-bottom: 4px">${event.title || 'Untitled Event'}</div>
                    <div style="font-size: 13px; color: #666">
                        ${event.date?.start ? new Date(event.date.start).toLocaleString() : 'No date'}
                    </div>
                  </td>
                  <td>
                    ${event.venue?.name || 'Unknown Venue'}
                    <div style="font-size: 12px; color: #888">${event.venue?.address || ''}</div>
                  </td>
                  <td>
                    ${event.source?.itemId ? `<a href="https://instagram.com/p/${event.source.itemId}" target="_blank">Instagram</a>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
            } else {
                htmlContent += `<div class="empty-state">No events were created from this run.</div>`;
            }

            res.send(renderPage(`Run ${runId}`, htmlContent));
            return;
        }

        // 2. List View: Show recent runs
        const runsSnapshot = await externalDb.collection('apifyRuns')
            .where('status', '==', 'COMPLETED')
            .orderBy('completedAt', 'desc')
            .limit(20)
            .get();

        const runs = runsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        let listContent = `
      <h1>Processed Runs</h1>
      <table>
        <thead>
          <tr>
            <th>Run ID</th>
            <th>Date</th>
            <th>Type</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${runs.map(run => {
            const date = run.initiatedAt ? new Date(run.initiatedAt).toLocaleString() : 'N/A';
            const statusClass = run.classificationStatus === 'COMPLETED' ? 'badge-success' : (run.classificationStatus === 'FAILED' ? 'badge-warning' : 'badge-secondary');
            const statusLabel = run.classificationStatus || 'PENDING';

            return `
              <tr>
                <td style="font-family: monospace; font-size: 13px">${run.runId}</td>
                <td>${date}</td>
                <td>${run.type || 'posts'}</td>
                <td><span class="badge ${statusClass}">${statusLabel}</span></td>
                <td><a href="?runId=${run.runId}">View Events</a></td>
              </tr>
            `;
        }).join('')}
        </tbody>
      </table>
    `;

        if (runs.length === 0) {
            listContent += `<div class="empty-state">No completed runs found.</div>`;
        }

        res.send(renderPage('Processed Runs', listContent));

    } catch (error) {
        logger.error('viewProcessedRuns error', { error: error.message });
        res.status(500).send('Internal Server Error: ' + error.message);
    }
});
