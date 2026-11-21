export interface AuditAdvisory {
  id?: number;
  github_advisory_id?: string;
  module_name?: string;
  patched_versions?: string;
  severity?: string;
  title?: string;
}

export interface AuditReport {
  advisories?: Record<string, AuditAdvisory>;
}

export declare function stripAuditConfig(yamlText: string): string;
export declare function ghsasInWorkspace(yamlText: string): string[];
export declare function failingAdvisories(audit: AuditReport): string[];
export declare function staleExceptions(ghsas: string[], audit: AuditReport): string[];
export declare function ignoredGhsas(dir: string): string[];
export declare function isServiceError(error: unknown): boolean;
export declare class AuditUnavailable extends Error {}
export declare function checkRoot(
  dir: string,
  options?: { runAudit?: (dir: string) => AuditReport },
): { ghsas: string[]; problems: string[]; error?: unknown };
