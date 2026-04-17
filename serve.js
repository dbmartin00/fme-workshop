#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // Parse URL and remove query string
    let filePath = req.url.split('?')[0];

    // Default to index listing
    if (filePath === '/') {
        serveIndex(res);
        return;
    }

    // Security: prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    filePath = '.' + filePath;

    // Only serve HTML files and assets (images, css, js)
    const ext = path.extname(filePath).toLowerCase();
    const allowedExtensions = ['.html', '.htm', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico'];

    if (!allowedExtensions.includes(ext)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden - Only HTML and asset files are served');
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
        } else {
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

function serveIndex(res) {
    // Find all HTML files in current directory
    const files = fs.readdirSync('.')
        .filter(f => f.endsWith('.html') && !f.endsWith('.template'))
        .sort();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>FME Workshop Files</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007bff;
            padding-bottom: 10px;
        }
        .file-list {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .file-item {
            padding: 12px;
            border-bottom: 1px solid #eee;
            transition: background 0.2s;
        }
        .file-item:hover {
            background: #f8f9fa;
        }
        .file-item:last-child {
            border-bottom: none;
        }
        a {
            color: #007bff;
            text-decoration: none;
            font-size: 16px;
        }
        a:hover {
            text-decoration: underline;
        }
        .info {
            color: #666;
            font-size: 14px;
            margin-top: 20px;
            padding: 15px;
            background: #fff3cd;
            border-radius: 4px;
            border-left: 4px solid #ffc107;
        }
    </style>
</head>
<body>
    <h1>🚀 FME Workshop Files</h1>
    <div class="file-list">
        ${files.length > 0
            ? files.map(f => `<div class="file-item">📄 <a href="/${f}">${f}</a></div>`).join('')
            : '<div class="file-item">No HTML files found. Run the generator first: <code>node index.js</code></div>'
        }
    </div>
    <div class="info">
        <strong>Server running on port ${PORT}</strong><br>
        Press Ctrl+C to stop
    </div>
</body>
</html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
}

server.listen(PORT, () => {
    console.log('\n🌐 FME Workshop Server');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n📂 Serving HTML files at: http://localhost:${PORT}`);
    console.log(`\n✓ Only HTML and asset files are accessible`);
    console.log(`✓ Source code (index.js, etc.) is protected`);
    console.log('\nPress Ctrl+C to stop the server\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Server stopped');
    process.exit(0);
});
