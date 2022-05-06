import {ExecJSON} from 'inspecjs';
import moment from 'moment';
import Mustache from 'mustache';
import {version as HeimdallToolsVersion} from '../../../package.json';
import {
  MappedXCCDFtoHDF,
  TestResultEnum
} from '../../../types/reverseMappedXCCDF';

function getXCCDFResult(control: ExecJSON.Control): TestResultEnum {
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

  getControlInfo(control: ExecJSON.Control) {
    return {
      groupId:
        'xccdf_mitre.hdf-converters.xccdf_group_' +
        control.id.replace(/\s/g, '_'),
      id:
        'xccdf_mitre.hdf-converters.xccdf_rule_' +
        control.id.replace(/\s/g, '_'),
      title: control.title || '',
      description:
        control.desc ||
        control.descriptions?.find(
          (description) => description.label === 'default'
        )?.data ||
        '',
      checkContent:
        control.descriptions?.find(
          (description) => description.label === 'check'
        )?.data ||
        control.tags.check ||
        '',
      code: control.code || '',
      fix:
        control.descriptions?.find(
          (description) => description.label === 'fix'
        )?.data ||
        control.tags.fix ||
        '',
      ccis: control.tags.cci || []
    }
  }

  getControlResultsInfo(control: ExecJSON.Control) {
    return {
      idref:
        'xccdf_mitre.hdf-converters.xccdf_rule_' +
        control.id.replace(/\s/g, '_'),
      result: getXCCDFResult(control),
      message: getMessages(control.results),
      messageType: getXCCDFResultMessageSeverity(control.results),
      check: control.code || ''
    }
  }

  toXCCDF() {
    const mappedData: MappedXCCDFtoHDF = {
      Benchmark: {
        id: 'xccdf_mitre.hdf-converters.xccdf_benchmark_hdf2xccdf',
        date: this.dateOverride ? '1970-01-01' : moment().format('YYYY-MM-DD'),
        metadata: {
          copyright: this.data.profiles[0].copyright || '',
          maintainer: this.data.profiles[0].maintainer || ''
        },
        version: HeimdallToolsVersion,
        Profile: [],
        Rule: [],
        TestResult: {
          endTime: this.dateOverride
            ? '2022-05-06T21:46:47.939Z'
            : new Date().toISOString(),
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
          (profile.title?.replace(/\s/g, '_') || 'profile_missing_title'),
        title: profile.title || '',
        description: profile.description || '',
        // All control IDs
        select: profile.controls.map(
          (control) =>
            'xccdf_mitre.hdf-converters.xccdf_rule_' +
            control.id.replace(/\s/g, '_')
        ) 
      });
      mappedData.Benchmark.TestResult.attributes.push(
        ...(profile.attributes || [])
      );
      if (mappedData.Benchmark.TestResult.attributes.length > 0) {
        mappedData.Benchmark.TestResult.hasAttributes = true;
      }

      profile.controls.forEach((control) => {
        // Add control info
        mappedData.Benchmark.Rule.push(this.getControlInfo(control));
        // Add results info
        mappedData.Benchmark.TestResult.results.push(this.getControlResultsInfo(control));
      });
    });

    return Mustache.render(this.xccdfTemplate, mappedData);
  }
}
