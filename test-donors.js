const http = require('http');

const BLOCKS = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9', 'J10'];

const delay = ms => new Promise(res => setTimeout(res, ms));

async function submitDonors(count = 10) {
  console.log(`Submitting ${count} dummy donors rapidly...`);
  
  const successful = [];
  const failed = [];

  for (let i = 0; i < count; i++) {
    const blockId = BLOCKS[Math.floor(Math.random() * BLOCKS.length)];
    const payload = JSON.stringify({
      name: `Dummy Donor ${Math.floor(Math.random() * 10000)}`,
      qty: 1,
      phone: '1234567890',
      whatsapp: '1234567890',
      payment_method: 'cash'
    });

    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 3000,
          path: `/api/blocks/${blockId}/donate`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsed = JSON.parse(data);
              resolve(`Success: ${parsed.submission?.name || 'Donor'} to block ${blockId}`);
            } else {
              reject(`Failed: Status ${res.statusCode} - ${data}`);
            }
          });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      successful.push(result);
    } catch (err) {
      failed.push(err);
    }
    
    // Add a tiny delay to avoid hitting Prisma's serializable transaction conflict
    // but fast enough to queue up popups on the frontend.
    await delay(100);
  }

  console.log(`\nSuccessfully submitted ${successful.length}/${count} donors.`);
  if (failed.length > 0) {
    console.log(`\nFailed submissions:`);
    failed.forEach(f => console.log(f));
  } else {
    successful.forEach(s => console.log(s));
  }
}

submitDonors(10);
