import { Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

// Create email transporter
const createTransporter = () => {
  // Configure transporter - authentication is optional
  const config: any = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // true for 465, false for other ports
  };

  // Only add authentication if credentials are provided
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    config.auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    };
  }

  return nodemailer.createTransport(config);
};

interface BugReport {
  title: string;
  description: string;
  stepsToReproduce?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  browserInfo?: string;
  userEmail?: string;
  username?: string;
}

export async function submitBugReport(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const bugReport: BugReport = req.body;

    // Validate required fields
    if (!bugReport.title || !bugReport.description) {
      res.status(400).json({
        error: 'Title and description are required'
      });
      return;
    }

    logger.info(`Bug report submitted by ${user?.username || 'Unknown'}: ${bugReport.title}`);

    // Create email content
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
          🐛 St0r Bug Report
        </h2>

        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1f2937;">${bugReport.title}</h3>
          <p style="color: #4b5563; margin: 5px 0;">
            <strong>Submitted by:</strong> ${user?.username || 'Unknown'}
            ${bugReport.userEmail ? `(${bugReport.userEmail})` : ''}
          </p>
          <p style="color: #4b5563; margin: 5px 0;">
            <strong>Date:</strong> ${new Date().toLocaleString()}
          </p>
        </div>

        <div style="margin: 20px 0;">
          <h4 style="color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;">
            Description
          </h4>
          <p style="color: #4b5563; white-space: pre-wrap;">${bugReport.description}</p>
        </div>

        ${bugReport.stepsToReproduce ? `
        <div style="margin: 20px 0;">
          <h4 style="color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;">
            Steps to Reproduce
          </h4>
          <p style="color: #4b5563; white-space: pre-wrap;">${bugReport.stepsToReproduce}</p>
        </div>
        ` : ''}

        ${bugReport.expectedBehavior ? `
        <div style="margin: 20px 0;">
          <h4 style="color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;">
            Expected Behavior
          </h4>
          <p style="color: #4b5563; white-space: pre-wrap;">${bugReport.expectedBehavior}</p>
        </div>
        ` : ''}

        ${bugReport.actualBehavior ? `
        <div style="margin: 20px 0;">
          <h4 style="color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;">
            Actual Behavior
          </h4>
          <p style="color: #4b5563; white-space: pre-wrap;">${bugReport.actualBehavior}</p>
        </div>
        ` : ''}

        ${bugReport.browserInfo ? `
        <div style="margin: 20px 0;">
          <h4 style="color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;">
            Browser Information
          </h4>
          <p style="color: #4b5563; font-family: monospace; font-size: 12px;">${bugReport.browserInfo}</p>
        </div>
        ` : ''}

        <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px;">
            This bug report was automatically generated from St0r GUI v1.6.4
          </p>
        </div>
      </div>
    `;

    const emailText = `
St0r Bug Report

Title: ${bugReport.title}
Submitted by: ${user?.username || 'Unknown'} ${bugReport.userEmail ? `(${bugReport.userEmail})` : ''}
Date: ${new Date().toLocaleString()}

Description:
${bugReport.description}

${bugReport.stepsToReproduce ? `Steps to Reproduce:\n${bugReport.stepsToReproduce}\n\n` : ''}
${bugReport.expectedBehavior ? `Expected Behavior:\n${bugReport.expectedBehavior}\n\n` : ''}
${bugReport.actualBehavior ? `Actual Behavior:\n${bugReport.actualBehavior}\n\n` : ''}
${bugReport.browserInfo ? `Browser Info:\n${bugReport.browserInfo}\n\n` : ''}

---
This bug report was automatically generated from St0r GUI v1.6.4
    `;

    // Check if SMTP is configured
    if (!process.env.SMTP_HOST) {
      // Log bug report to file if email not configured
      logger.warn('SMTP not configured. Bug report logged to console.');
      logger.info('Bug Report Content:', { bugReport, user: user?.username });

      res.json({
        success: true,
        message: 'Bug report logged successfully. Email not configured.',
        note: 'Bug report has been logged to the server logs.'
      });
      return;
    }

    try {
      const transporter = createTransporter();

      // Determine "from" address
      const fromAddress = process.env.SMTP_USER || 'agit8or@agit8or.net';

      // Send email
      await transporter.sendMail({
        from: `"St0r Bug Reports" <${fromAddress}>`,
        to: 'agit8or@agit8or.net',
        subject: `[St0r Bug Report] ${bugReport.title}`,
        text: emailText,
        html: emailHtml,
        replyTo: bugReport.userEmail || undefined
      });

      logger.info(`Bug report email sent successfully to agit8or@agit8or.net`);

      res.json({
        success: true,
        message: 'Bug report submitted successfully. Thank you for helping improve St0r!'
      });

    } catch (emailError: any) {
      logger.error('Failed to send bug report email:', emailError);

      // Still log the bug report even if email fails
      logger.info('Bug Report Content (email failed):', { bugReport, user: user?.username });

      res.json({
        success: true,
        message: 'Bug report logged successfully.',
        note: 'Email delivery failed but your report has been logged.'
      });
    }

  } catch (error: any) {
    logger.error('Failed to process bug report:', error);
    res.status(500).json({
      error: 'Failed to submit bug report',
      message: error.message
    });
  }
}
