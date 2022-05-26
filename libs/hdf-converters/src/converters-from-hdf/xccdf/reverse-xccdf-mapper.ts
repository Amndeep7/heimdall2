import {ExecJSON} from 'inspecjs';
import _ from 'lodash';
import moment from 'moment';
import Mustache from 'mustache';
import {version as HeimdallToolsVersion} from '../../../package.json';
import {
  MappedXCCDFtoHDF,
  TestResultStatus,
  XCCDFSeverity
} from '../../../types/reverseMappedXCCDF';

const DATE_FORMAT = 'YYYY-MM-DD';
const TESTING_DATE_OVERRIDE = '1970-01-01';
const TESTING_DATETIME_OVERRIDE = '2022-05-06T21:46:47.939Z';

function getXCCDFResult(control: ExecJSON.Control): TestResultStatus {
  if (control.results.some((result) => result.backtrace)) {
    return 'error';
  }
  if (control.results.some((result) => !result.status)) {
    return 'unknown';
  }

  if (control.results.every((result) => result.status === 'passed')) {
    return 'pass';
  }

  if (control.results.every((result) => result.status === 'skipped')) {
    return 'notchecked';
  }

  if (control.results.some((result) => result.status === 'failed')) {
    return 'fail';
  }

  return 'unknown';
}

function getXCCDFResultMessageSeverity(segments: ExecJSON.ControlResult[]) {
  if (segments.some((result) => result.backtrace)) {
    return 'medium';
  }
  return 'info';
}

function toMessageLine(segment: ExecJSON.ControlResult): string {
  switch (segment.status) {
    case 'skipped':
      return `SKIPPED -- ${segment.skip_message}\n`;
    case 'failed':
      return `FAILED -- Test: ${segment.code_desc}\nMessage: ${segment.message}\n`;
    case 'passed':
      return `PASSED -- ${segment.code_desc}"`;
    case 'error':
      return `ERROR -- Test: ${segment.code_desc}\nMessage: ${segment.message}`;
    default:
      return `Exception: ${segment.exception}`;
  }
}

function getMessages(segments: ExecJSON.ControlResult[]) {
  return segments.map(toMessageLine).join('\n\n');
}

export class FromHDFToXCCDFMapper {
  data: ExecJSON.Execution;
  xccdfTemplate: string;
  dateOverride: boolean;

  constructor(data: string, xccdfTemplate: string, dateOverride = false) {
    this.data = JSON.parse(data);
    this.xccdfTemplate = xccdfTemplate;
    this.dateOverride = dateOverride;
  }

  getSeverity(control: ExecJSON.Control): XCCDFSeverity {
    if (control.impact < 0.1) {
      return 'info';
    } else if (control.impact < 0.4) {
      return 'low';
    } else if (control.impact < 0.7) {
      return 'medium';
    } else {
      return 'high';
    }
  }

  getControlInfo(control: ExecJSON.Control) {
    const knownDescriptions = [
      'default',
      'check',
      'fix',
      'gtitle',
      'gid',
      'stig_id',
      'cci',
      'satisfies',
      'fix_id',
      'documentable'
    ];

    return {
      groupId:
        'xccdf_mitre.hdf-converters.xccdf_group_' +
        control.id.replace(/[^\w]/g, '_').replace(/\s/g, '_'),
      id:
        'xccdf_mitre.hdf-converters.xccdf_rule_' +
        control.id.replace(/[^\w]/g, '_').replace(/\s/g, '_'),
      version: control.tags.stig_id || '',
      title: control.tags.gtitle || control.title || '',
      severity: this.getSeverity(control),
      description:
        control.desc +
          (control.tags.satisfies
            ? '\n\nSatisfies: ' + control.tags.satisfies.join(', ')
            : '') ||
        control.descriptions?.find(
          (description) => description.label === 'default'
        )?.data ||
        '',
      documentable: control.tags.documentable || false,
      descriptions: (control.descriptions || []).filter(
        (description) => !knownDescriptions.includes(description.label)
      ),
      checkContent:
        control.descriptions?.find(
          (description) => description.label === 'check'
        )?.data ||
        control.tags.check ||
        '',
      tags: Object.entries(control.tags)
        .filter(([key]) => !knownDescriptions.includes(key))
        .map(([key, value]) => `${key}: ${value}`),
      code: control.code || '',
      fixid: control.tags.fix_id,
      fix:
        control.descriptions?.find((description) => description.label === 'fix')
          ?.data ||
        control.tags.fix ||
        '',
      ccis: control.tags.cci || []
    };
  }

  getExecutionTime(isoTime = false): string {
    // Extract the first results from profile level
    const results: ExecJSON.ControlResult[] = [];

    this.data.profiles.forEach((profile) =>
      results.push(...profile.controls[0].results)
    );

    // Find the execution time from the first profile level that contains it
    for (const result of results) {
      if (typeof result.start_time === 'string') {
        // Date parsing can be tricky sometimes
        try {
          const parsedDate = moment(result.start_time);
          if (parsedDate.isValid()) {
            return isoTime
              ? moment(result.start_time).toISOString()
              : moment(result.start_time, false).format(DATE_FORMAT);
          }
        } catch {
          return isoTime
            ? moment().toISOString()
            : moment().format(DATE_FORMAT);
        }
      }
    }

    // Default return date is now
    return isoTime ? moment().toISOString() : moment().format(DATE_FORMAT);
  }

  getControlResultsInfo(control: ExecJSON.Control) {
    return {
      idref:
        'xccdf_mitre.hdf-converters.xccdf_rule_' +
        control.id.replace(/[^\w]/g, '_').replace(/\s/g, '_'),
      result: getXCCDFResult(control),
      message: getMessages(control.results),
      messageType: getXCCDFResultMessageSeverity(control.results),
      code: control.code || ''
    };
  }

  toXCCDF() {
    const passthrough = _.get(this.data, 'passthrough');
    let passthroughString = '';
    if (typeof passthrough === 'object' && passthrough) {
      passthroughString = JSON.stringify(passthrough);
    } else if (typeof passthrough !== 'undefined') {
      passthroughString = String(passthrough);
    }

    const mappedData: MappedXCCDFtoHDF = {
      Benchmark: {
        id: 'xccdf_mitre.hdf-converters.xccdf_benchmark_hdf2xccdf',
        title: this.data.profiles[0].title || 'HDF to XCCDF Benchmark',
        date: this.dateOverride
          ? TESTING_DATE_OVERRIDE
          : this.getExecutionTime(),
        metadata: {
          copyright: this.data.profiles[0].copyright || '',
          maintainer: this.data.profiles[0].maintainer || ''
        },
        passthrough: passthroughString,
        version: HeimdallToolsVersion,
        Profile: [],
        Rule: [],
        TestResult: {
          endTime: this.dateOverride
            ? TESTING_DATETIME_OVERRIDE
            : this.getExecutionTime(true),
          hasAttributes: false,
          attributes: [],
          results: []
        }
      }
    };

    this.data.profiles.forEach((profile) => {
      // Add Profile to Profile list
      mappedData.Benchmark.Profile.push({
        id:
          'xccdf_mitre.hdf-converters_profile_hdf2xccdf_' +
          // Replace all non-word characters and spaces with underscores
          (profile.title?.replace(/[^\w]/g, '_').replace(/\s/g, '_') ||
            'profile_missing_title'),
        title: profile.title || '',
        description: profile.description || '',
        // All control IDs
        select: profile.controls.map(
          (control) =>
            'xccdf_mitre.hdf-converters.xccdf_rule_' +
            control.id.replace(/[^\w]/g, '_').replace(/\s/g, '_')
        )
      });
      mappedData.Benchmark.TestResult.attributes.push(
        ...(profile.attributes || [])
      );
      if (mappedData.Benchmark.TestResult.attributes.length > 0) {
        mappedData.Benchmark.TestResult.hasAttributes = true;
      }

      profile.controls.forEach((control) => {
        // Add results info
        mappedData.Benchmark.TestResult.results.push(
          this.getControlResultsInfo(control)
        );
      });
    });

    // Add the control metadata for the top-level profile
    this.data.profiles[0].controls.forEach((control) => {
      mappedData.Benchmark.Rule.push(this.getControlInfo(control));
    });

    return Mustache.render(this.xccdfTemplate, mappedData);
  }
}
