import { fetchReportAnalyticsRange } from './weekly-data-completeness.mjs';
import { readFile } from 'node:fs/promises';
import { generateWeeklyNaverAdsReport, previousTuesdayToMondayRange, seoulDateKey } from './naver-ads-weekly-report.mjs';
import { generateWeeklyMetaAdsReport, resolveMetaWeeklyReportOutputDir } from './meta-ads-weekly-report.mjs';
import { generateWeeklyInstagramReport } from './instagram-weekly-report.mjs';
import {
  dropboxWeeklyReportDir, findPublishedReport, reconcileWeeklyFailureNotice,
  resolvePlatformDropboxDestination, resolveWeeklyReportDestination, saveWeeklyReportToDropboxAtPath
} from './dropbox-report-uploader.mjs';
import { restoreIssuedMetaReport, inspectIssuedStorage } from './meta-issued-report.mjs';
import { calendarMonthPeriod, isReportDate } from './report-period.mjs';

export const reportPlatforms = ['meta', 'naver', 'instagram'];

export function officialReportPeriod({ cadence = 'weekly', since, until }, now = new Date()) {
  if (!isReportDate(since) || !isReportDate(until) || until >= seoulDateKey(now)) throw new Error('invalid_closed_period');
  if (cadence === 'weekly' && new Date(since).getUTCDay() === 2 && Date.parse(until) - Date.parse(since) === 6 * 86400000) {
    return { cadence, since, until, referenceDateKey: new Date(Date.parse(until) + 86400000).toISOString().slice(0, 10) };
  }
  if (cadence === 'monthly') {
    const month = since.slice(0, 7);
    const range = calendarMonthPeriod(month);
    if (range.since === since && range.until === until) return { cadence, since, until, month };
  }
  throw new Error('invalid_report_period');
}

export function dueMonthlyReport(now) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  // The first seven mornings allow retries after a source or Render outage.
  if (kst.getUTCDate() > 7 || kst.getUTCHours() !== 10) return null;
  return { cadence: 'monthly', ...calendarMonthPeriod(kst.toISOString().slice(0, 7), -1) };
}

export function officialReportDestination(platform, env) {
  if (platform === 'naver') return { ...resolveWeeklyReportDestination(env), dir: dropboxWeeklyReportDir(env) };
  return resolvePlatformDropboxDestination(env, platform === 'meta'
    ? { dirEnvKey: 'DROPBOX_META_WEEKLY_REPORT_DIR', defaultDir: '/SAMPLAS WORK/병구 작업/메타 광고/리포트' }
    : { dirEnvKey: 'DROPBOX_INSTAGRAM_WEEKLY_REPORT_DIR', defaultDir: '/SAMPLAS WORK/병구 작업/인스타그램 리포트' });
}

export async function publishOfficialReport({ platform, cadence, since, until }, {
  env = process.env, fetchers, fetchImpl = fetch, now = new Date(), scheduled = false
} = {}) {
  if (!reportPlatforms.includes(platform)) throw new Error('invalid_platform');
  const period = officialReportPeriod({ cadence, since, until }, now);
  const destination = officialReportDestination(platform, env);
  if (destination.mode !== 'dropbox') throw new Error('official_report_dropbox_required');
  const prefix = { meta: 'META_ADS', naver: 'NAVER_ADS', instagram: 'INSTAGRAM' }[platform];
  const targetPath = `${destination.dir.replace(/\/+$/, '')}/${prefix}_${period.cadence.toUpperCase()}_${since}_${until}.xlsx`;
  const options = { targetPath, env, fetchImpl };
  const published = await findPublishedReport(options);
  let result;
  if (published) {
    const { bytes, workbook, ...delivery } = published;
    result = { ok: true, since, until, ...delivery };
    if (platform === 'meta' && !period.month && workbook.getWorksheet('ISSUE_EVIDENCE')) {
      const outputDir = resolveMetaWeeklyReportOutputDir(env);
      if ((await inspectIssuedStorage({ outputDir, env })).ok) {
        try { await restoreIssuedMetaReport({ outputDir, workbook, bytes, since, until }); }
        catch { result.warning = 'published_meta_ledger_repair_failed'; }
      } else {
        result.warning = 'issued_storage_unverified';
      }
    }
  } else {
    const common = {
      env, referenceDateKey: period.referenceDateKey, month: period.month, requireCompleteData: true,
      saveReport: workbook => saveWeeklyReportToDropboxAtPath(workbook, options)
    };
    if (platform === 'meta') {
      result = await generateWeeklyMetaAdsReport({
        ...fetchers.meta, ...common, onePage: true, now: () => now,
        fetchActualOrders: fetchers.meta?.fetchActualOrders
          ? (start, end, args) => fetchers.meta.fetchActualOrders(start, end, { ...args, officialReport: !scheduled || Boolean(period.month) })
          : undefined,
        fetchActualAnalytics: period.month && fetchers.meta?.fetchActualAnalytics
          ? (start, end) => fetchReportAnalyticsRange(start, end, fetchers.meta.fetchActualAnalytics)
          : fetchers.meta?.fetchActualAnalytics,
        period: period.month ? undefined : { since, until },
        publicationMode: period.month ? 'monthly' : scheduled ? 'scheduled' : 'recovery'
      });
      if (result.publication?.alreadyIssued) {
        const bytes = await readFile(result.publication.filePath);
        const delivery = await common.saveReport({ xlsx: { writeBuffer: async () => bytes } });
        result = { ...result, ...delivery };
      }
    } else if (platform === 'naver') {
      result = await generateWeeklyNaverAdsReport({
        ...common, fetchPerformance: fetchers.naver,
        fetchAttribution: period.month ? fetchers.naverMonthlyAttribution : fetchers.naverWeeklyAttribution
      });
    } else {
      result = await generateWeeklyInstagramReport({ ...common, fetchRange: fetchers.instagram });
    }
  }
  if (!result.ok) return { ok: false, platform, cadence: period.cadence, since, until, error: result.error };
  let warning = result.warning;
  try { await reconcileWeeklyFailureNotice(options); }
  catch { warning = [warning, 'published_failure_notice_reconciliation_pending'].filter(Boolean).join(','); }
  return { ok: true, platform, cadence: period.cadence, since, until, filePath: targetPath,
    alreadyExists: result.alreadyExists === true,
    ...(warning ? { warning } : {}) };
}

export function dueWeeklyPeriod(now) {
  return { cadence: 'weekly', ...previousTuesdayToMondayRange(seoulDateKey(now)) };
}
