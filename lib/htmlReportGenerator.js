/**
 * HTML Visual Report Generator for Photo Workflow
 * 
 * Generates comprehensive visual reports with embedded CSS, thumbnail previews,
 * and detailed analysis of grouping decisions and representative selections.
 */

const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { format } = require('date-fns');

class HtmlReportGenerator {
  constructor(options = {}) {
    this.outputDir = options.outputDir || './output';
    this.thumbnailSize = options.thumbnailSize || { width: 150, height: 150 };
    this.thumbnailQuality = options.thumbnailQuality || 80;
    this.reportDir = path.join(this.outputDir, 'reports');
    this.thumbnailDir = path.join(this.reportDir, 'thumbnails');
    this.verbose = options.verbose || false;
  }

  /**
   * Initialize report generator
   */
  async initialize() {
    await fs.ensureDir(this.reportDir);
    await fs.ensureDir(this.thumbnailDir);
  }

  /**
   * Generate grouping stage HTML report
   */
  async generateGroupingReport(groups, metadata, auditLogger) {
    await this.initialize();
    
    if (this.verbose) {
      console.log('Generating grouping visual report...');
    }

    try {
      // Generate thumbnails for all images
      const thumbnailMap = await this.generateThumbnails(groups, auditLogger);
      
      // Calculate statistics
      const stats = this.calculateGroupingStats(groups, metadata);
      
      // Generate HTML report
      const html = await this.buildGroupingHtml(groups, thumbnailMap, stats, metadata);
      
      // Write report file
      const reportPath = path.join(this.reportDir, 'GROUPING_REPORT.html');
      await fs.writeFile(reportPath, html, 'utf8');
      
      if (auditLogger) {
        auditLogger.logEvent('html_report_generated', {
          reportPath,
          groupCount: groups.length,
          thumbnailCount: Object.keys(thumbnailMap).length
        });
      }
      
      return {
        success: true,
        reportPath,
        thumbnailCount: Object.keys(thumbnailMap).length,
        groupCount: groups.length
      };
      
    } catch (error) {
      if (auditLogger) {
        auditLogger.logError(error, { operation: 'generate_grouping_report' });
      }
      throw error;
    }
  }

  /**
   * Generate thumbnails for all images in groups
   */
  async generateThumbnails(groups, auditLogger) {
    const thumbnailMap = {};
    let processed = 0;
    let total = 0;
    
    // Count total images
    groups.forEach(group => {
      total += group.files.length;
    });
    
    if (auditLogger) {
      auditLogger.logEvent('thumbnail_generation_start', { totalImages: total });
    }
    
    for (const group of groups) {
      for (const image of group.files) {
        try {
          const thumbnailPath = await this.generateSingleThumbnail(image.filePath, image.fileName);
          const relativePath = path.relative(this.reportDir, thumbnailPath);
          thumbnailMap[image.filePath] = relativePath;
          processed++;
          
          if (processed % 10 === 0 && this.verbose) {
            console.log(`Generated ${processed}/${total} thumbnails`);
          }
          
        } catch (error) {
          if (auditLogger) {
            auditLogger.logError(error, {
              operation: 'generate_thumbnail',
              filePath: image.filePath
            });
          }
          // Use placeholder for failed thumbnails
          thumbnailMap[image.filePath] = this.getPlaceholderThumbnail();
        }
      }
    }
    
    if (auditLogger) {
      auditLogger.logEvent('thumbnail_generation_complete', {
        processed,
        failed: total - processed
      });
    }
    
    return thumbnailMap;
  }

  /**
   * Generate single thumbnail
   */
  async generateSingleThumbnail(imagePath, fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const thumbnailName = `thumb_${path.basename(fileName, ext)}.jpg`;
    const thumbnailPath = path.join(this.thumbnailDir, thumbnailName);
    
    // Check if thumbnail already exists
    if (await fs.pathExists(thumbnailPath)) {
      return thumbnailPath;
    }
    
    await sharp(imagePath)
      .resize(this.thumbnailSize.width, this.thumbnailSize.height, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: this.thumbnailQuality })
      .toFile(thumbnailPath);
    
    return thumbnailPath;
  }

  /**
   * Get placeholder thumbnail path for failed generation
   */
  getPlaceholderThumbnail() {
    return 'data:image/svg+xml;base64,' + Buffer.from(`
      <svg width="150" height="150" xmlns="http://www.w3.org/2000/svg">
        <rect width="150" height="150" fill="#f0f0f0" stroke="#ddd"/>
        <text x="75" y="75" text-anchor="middle" fill="#999" font-family="Arial" font-size="12">No Preview</text>
      </svg>
    `).toString('base64');
  }

  /**
   * Calculate grouping statistics
   */
  calculateGroupingStats(groups, metadata) {
    const totalImages = groups.reduce((sum, group) => sum + group.files.length, 0);
    
    const stats = {
      totalGroups: groups.length,
      totalImages,
      averageGroupSize: Math.round(totalImages / groups.length),
      smallGroups: groups.filter(g => g.files.length < 5).length,
      mediumGroups: groups.filter(g => g.files.length >= 5 && g.files.length < 20).length,
      largeGroups: groups.filter(g => g.files.length >= 20).length,
      timeSpanStats: {
        shortest: Math.min(...groups.map(g => g.timeSpan || 0)),
        longest: Math.max(...groups.map(g => g.timeSpan || 0)),
        average: Math.round(groups.reduce((sum, g) => sum + (g.timeSpan || 0), 0) / groups.length)
      },
      processingInfo: {
        generatedAt: new Date().toISOString(),
        processingDuration: metadata?.duration || 0,
        algorithm: 'Temporal + Visual Similarity'
      }
    };
    
    return stats;
  }

  /**
   * Build complete HTML report
   */
  async buildGroupingHtml(groups, thumbnailMap, stats, metadata) {
    const css = this.getReportCSS();
    const headerHtml = this.buildReportHeader(stats);
    const summaryHtml = this.buildSummarySection(stats);
    const groupsHtml = this.buildGroupsSection(groups, thumbnailMap);
    const footerHtml = this.buildReportFooter();
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Photo Grouping Report - ${format(new Date(), 'yyyy-MM-dd HH:mm')}</title>
    <style>${css}</style>
</head>
<body>
    <div class="container">
        ${headerHtml}
        ${summaryHtml}
        ${groupsHtml}
        ${footerHtml}
    </div>
    
    <script>
        // Interactive functionality
        ${this.getReportJavaScript()}
    </script>
</body>
</html>`;
  }

  /**
   * Get embedded CSS styles
   */
  getReportCSS() {
    return `
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f8f9fa;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            border-radius: 12px;
            margin-bottom: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            font-weight: 700;
        }
        
        .header .subtitle {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .stat-card .number {
            font-size: 2.5rem;
            font-weight: 700;
            color: #667eea;
            display: block;
        }
        
        .stat-card .label {
            color: #666;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .section-title {
            font-size: 1.8rem;
            margin: 40px 0 20px 0;
            color: #333;
            border-bottom: 3px solid #667eea;
            padding-bottom: 10px;
        }
        
        .group-container {
            background: white;
            margin-bottom: 30px;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        
        .group-header {
            background: linear-gradient(90deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 20px;
            border-bottom: 1px solid #dee2e6;
        }
        
        .group-header h3 {
            color: #495057;
            margin-bottom: 8px;
            font-size: 1.3rem;
        }
        
        .group-meta {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            font-size: 0.85rem;
            color: #6c757d;
        }
        
        .group-meta .meta-item {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .group-meta .meta-icon {
            width: 16px;
            height: 16px;
            opacity: 0.7;
        }
        
        .representative-section {
            padding: 20px;
            background: linear-gradient(45deg, #fff9e6 0%, #fff2cc 100%);
            border-left: 5px solid #ffd700;
        }
        
        .representative-section h4 {
            color: #b8860b;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .representative-section .crown {
            font-size: 1.2rem;
        }
        
        .representative-image {
            display: inline-block;
            position: relative;
            margin-right: 20px;
        }
        
        .representative-image img {
            width: 200px;
            height: 200px;
            object-fit: cover;
            border-radius: 8px;
            border: 3px solid #ffd700;
            box-shadow: 0 4px 15px rgba(255, 215, 0, 0.3);
        }
        
        .representative-info {
            display: inline-block;
            vertical-align: top;
            margin-top: 10px;
        }
        
        .representative-info .filename {
            font-weight: 600;
            color: #333;
            margin-bottom: 5px;
        }
        
        .representative-info .timestamp {
            color: #666;
            font-size: 0.9rem;
            margin-bottom: 5px;
        }
        
        .representative-info .reason {
            background: #fff;
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid #ffd700;
            font-size: 0.85rem;
            color: #b8860b;
        }
        
        .members-section {
            padding: 20px;
        }
        
        .members-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        
        .member-thumbnail {
            position: relative;
            cursor: pointer;
            transition: transform 0.2s ease;
        }
        
        .member-thumbnail:hover {
            transform: scale(1.05);
        }
        
        .member-thumbnail img {
            width: 100%;
            height: 120px;
            object-fit: cover;
            border-radius: 6px;
            border: 2px solid #dee2e6;
        }
        
        .member-thumbnail.representative img {
            border-color: #ffd700;
            box-shadow: 0 2px 8px rgba(255, 215, 0, 0.4);
        }
        
        .member-info {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(transparent, rgba(0,0,0,0.8));
            color: white;
            padding: 8px 6px 6px;
            border-radius: 0 0 6px 6px;
            font-size: 0.75rem;
            line-height: 1.2;
        }
        
        .member-info .filename {
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .member-info .timestamp {
            opacity: 0.8;
        }
        
        .tooltip {
            position: absolute;
            z-index: 1000;
            background: #333;
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 0.8rem;
            pointer-events: none;
            max-width: 250px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        
        .collapsible-toggle {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            margin-top: 10px;
            transition: background 0.2s ease;
        }
        
        .collapsible-toggle:hover {
            background: #5a67d8;
        }
        
        .collapsible-content {
            display: none;
        }
        
        .collapsible-content.expanded {
            display: block;
        }
        
        .footer {
            text-align: center;
            padding: 30px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-top: 40px;
            color: #666;
        }
        
        .footer .timestamp {
            font-size: 0.9rem;
            margin-bottom: 10px;
        }
        
        .footer .signature {
            font-style: italic;
            color: #999;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .header {
                padding: 20px;
            }
            
            .header h1 {
                font-size: 1.8rem;
            }
            
            .summary-grid {
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            }
            
            .group-meta {
                grid-template-columns: 1fr;
            }
            
            .representative-image img {
                width: 150px;
                height: 150px;
            }
            
            .members-grid {
                grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
            }
        }
        
        @media print {
            body {
                background: white;
            }
            
            .container {
                max-width: none;
                margin: 0;
                padding: 15px;
            }
            
            .collapsible-toggle {
                display: none;
            }
            
            .collapsible-content {
                display: block !important;
            }
            
            .group-container {
                break-inside: avoid;
                box-shadow: none;
                border: 1px solid #ddd;
            }
        }
    `;
  }

  /**
   * Build report header
   */
  buildReportHeader(stats) {
    return `
        <div class="header">
            <h1>📸 Photo Grouping Report</h1>
            <div class="subtitle">
                Generated on ${format(new Date(), 'MMMM do, yyyy \'at\' h:mm a')}
                <br>
                ${stats.totalImages} photos organized into ${stats.totalGroups} groups
            </div>
        </div>
    `;
  }

  /**
   * Build summary section
   */
  buildSummarySection(stats) {
    return `
        <div class="summary-grid">
            <div class="stat-card">
                <span class="number">${stats.totalGroups}</span>
                <span class="label">Groups Created</span>
            </div>
            <div class="stat-card">
                <span class="number">${stats.totalImages}</span>
                <span class="label">Total Photos</span>
            </div>
            <div class="stat-card">
                <span class="number">${stats.averageGroupSize}</span>
                <span class="label">Avg Group Size</span>
            </div>
            <div class="stat-card">
                <span class="number">${stats.timeSpanStats.average}min</span>
                <span class="label">Avg Time Span</span>
            </div>
            <div class="stat-card">
                <span class="number">${stats.largeGroups}</span>
                <span class="label">Large Groups (20+)</span>
            </div>
            <div class="stat-card">
                <span class="number">${Math.round((stats.processingInfo.processingDuration || 0) / 1000)}s</span>
                <span class="label">Processing Time</span>
            </div>
        </div>
    `;
  }

  /**
   * Build groups section
   */
  buildGroupsSection(groups, thumbnailMap) {
    let html = '<h2 class="section-title">📁 Photo Groups</h2>';
    
    groups.forEach((group, index) => {
      const representative = this.findRepresentative(group);
      const representativeThumbnail = thumbnailMap[representative.filePath] || this.getPlaceholderThumbnail();
      
      html += `
        <div class="group-container">
            <div class="group-header">
                <h3>${group.name || `Group ${index + 1}`}</h3>
                <div class="group-meta">
                    <div class="meta-item">
                        <span class="meta-icon">📷</span>
                        <span>${group.files.length} photos</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-icon">⏱️</span>
                        <span>${group.timeSpan || 0} minutes span</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-icon">📅</span>
                        <span>${format(new Date(group.startTimestamp), 'MMM do, h:mm a')}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-icon">📸</span>
                        <span>${Array.from(group.cameras || []).join(', ') || 'Unknown'}</span>
                    </div>
                </div>
            </div>
            
            <div class="representative-section">
                <h4>
                    <span class="crown">👑</span>
                    Representative Photo
                </h4>
                <div class="representative-image">
                    <img src="${representativeThumbnail}" 
                         alt="${representative.fileName}"
                         loading="lazy">
                </div>
                <div class="representative-info">
                    <div class="filename">${representative.fileName}</div>
                    <div class="timestamp">${format(new Date(representative.timestamp), 'MMM do, yyyy h:mm a')}</div>
                    <div class="reason">${this.getRepresentativeReason(representative, group)}</div>
                </div>
            </div>
            
            <div class="members-section">
                <button class="collapsible-toggle" onclick="toggleCollapsible(this)">
                    View All ${group.files.length} Photos
                </button>
                <div class="collapsible-content">
                    <div class="members-grid">
                        ${group.files.map(file => this.buildMemberThumbnail(file, thumbnailMap, representative)).join('')}
                    </div>
                </div>
            </div>
        </div>
      `;
    });
    
    return html;
  }

  /**
   * Find representative image for a group
   */
  findRepresentative(group) {
    // For now, use temporal center (could be enhanced with visual similarity)
    const sortedByTime = [...group.files].sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );
    
    const centerIndex = Math.floor(sortedByTime.length / 2);
    return sortedByTime[centerIndex];
  }

  /**
   * Get reason why image was chosen as representative
   */
  getRepresentativeReason(representative, group) {
    const reasons = [];
    
    // Check if it's temporal center
    const sortedByTime = [...group.files].sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );
    const centerIndex = Math.floor(sortedByTime.length / 2);
    
    if (sortedByTime[centerIndex] === representative) {
      reasons.push('Temporal center of group');
    }
    
    // Add other criteria (could be enhanced)
    if (representative.width && representative.height) {
      const megapixels = (representative.width * representative.height) / 1000000;
      if (megapixels > 10) {
        reasons.push('High resolution');
      }
    }
    
    return reasons.join(', ') || 'Best representative based on analysis';
  }

  /**
   * Build member thumbnail HTML
   */
  buildMemberThumbnail(file, thumbnailMap, representative) {
    const thumbnail = thumbnailMap[file.filePath] || this.getPlaceholderThumbnail();
    const isRepresentative = file === representative;
    
    return `
      <div class="member-thumbnail ${isRepresentative ? 'representative' : ''}"
           data-filename="${file.fileName}"
           data-timestamp="${file.timestamp}"
           data-camera="${file.camera || 'Unknown'}"
           data-filesize="${this.formatFileSize(file.fileSize || 0)}"
           onmouseenter="showTooltip(event, this)"
           onmouseleave="hideTooltip()">
        <img src="${thumbnail}" alt="${file.fileName}" loading="lazy">
        <div class="member-info">
          <div class="filename">${this.truncateFilename(file.fileName, 15)}</div>
          <div class="timestamp">${format(new Date(file.timestamp), 'HH:mm')}</div>
        </div>
      </div>
    `;
  }

  /**
   * Build report footer
   */
  buildReportFooter() {
    return `
        <div class="footer">
            <div class="timestamp">Report generated on ${new Date().toISOString()}</div>
            <div class="signature">Photo Workflow POC - Automated Grouping Analysis</div>
        </div>
    `;
  }

  /**
   * Get JavaScript for interactive functionality
   */
  getReportJavaScript() {
    return `
        // Toggle collapsible sections
        function toggleCollapsible(button) {
            const content = button.nextElementSibling;
            const isExpanded = content.classList.contains('expanded');
            
            if (isExpanded) {
                content.classList.remove('expanded');
                button.textContent = button.textContent.replace('Hide', 'View');
            } else {
                content.classList.add('expanded');
                button.textContent = button.textContent.replace('View', 'Hide');
            }
        }
        
        // Tooltip functionality
        let tooltip = null;
        
        function showTooltip(event, element) {
            const filename = element.dataset.filename;
            const timestamp = element.dataset.timestamp;
            const camera = element.dataset.camera;
            const filesize = element.dataset.filesize;
            
            tooltip = document.createElement('div');
            tooltip.className = 'tooltip';
            tooltip.innerHTML = \`
                <strong>\${filename}</strong><br>
                📅 \${new Date(timestamp).toLocaleString()}<br>
                📸 \${camera}<br>
                💾 \${filesize}
            \`;
            
            document.body.appendChild(tooltip);
            updateTooltipPosition(event);
        }
        
        function hideTooltip() {
            if (tooltip) {
                tooltip.remove();
                tooltip = null;
            }
        }
        
        function updateTooltipPosition(event) {
            if (tooltip) {
                tooltip.style.position = 'fixed';
                tooltip.style.left = (event.clientX + 10) + 'px';
                tooltip.style.top = (event.clientY - 10) + 'px';
            }
        }
        
        // Update tooltip position on mouse move
        document.addEventListener('mousemove', updateTooltipPosition);
        
        // Print functionality
        function printReport() {
            // Expand all collapsed sections before printing
            const toggles = document.querySelectorAll('.collapsible-toggle');
            toggles.forEach(toggle => {
                const content = toggle.nextElementSibling;
                content.classList.add('expanded');
            });
            
            window.print();
        }
        
        // Add print button to header
        document.addEventListener('DOMContentLoaded', function() {
            const header = document.querySelector('.header');
            const printButton = document.createElement('button');
            printButton.textContent = '🖨️ Print Report';
            printButton.style.cssText = \`
                background: rgba(255,255,255,0.2);
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                margin-top: 15px;
                font-size: 0.9rem;
            \`;
            printButton.onclick = printReport;
            header.appendChild(printButton);
        });
    `;
  }

  /**
   * Helper: Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Helper: Truncate filename
   */
  truncateFilename(filename, maxLength) {
    if (filename.length <= maxLength) return filename;
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const truncated = base.substring(0, maxLength - ext.length - 3) + '...';
    return truncated + ext;
  }

  /**
   * Generate representative selection report
   */
  async generateRepresentativeReport(groups, selections, outputPath) {
    // This could be extended for more detailed representative analysis
    const reportPath = path.join(this.reportDir, 'REPRESENTATIVE_SELECTION.html');
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Representative Selection Report</title>
    <style>${this.getReportCSS()}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>👑 Representative Selection Analysis</h1>
            <div class="subtitle">Detailed analysis of representative photo selection logic</div>
        </div>
        <!-- Extended analysis could go here -->
    </div>
</body>
</html>`;
    
    await fs.writeFile(reportPath, html, 'utf8');
    return reportPath;
  }
}

module.exports = HtmlReportGenerator;