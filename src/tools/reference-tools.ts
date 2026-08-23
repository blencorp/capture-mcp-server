import { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  REFERENCE_DOMAINS,
  listReferenceCodes,
  lookupReferenceCode,
} from '../utils/fpds-codes.js';

// Static FPDS reference lookups — no network, no API key. This tool exists
// because code meanings get inverted from memory (8A vs 8AN produced a
// 12x-wrong figure in a real capture session); an agent should resolve every
// code here before putting a number in a memo.

export const referenceTools = {
  async getTools(): Promise<Tool[]> {
    return [
      {
        name: "lookup_reference_code",
        description:
          "Look up the official FPDS description for a procurement reference code, or list a whole domain. Domains: " +
          REFERENCE_DOMAINS.join(', ') +
          ". Use this BEFORE filtering or reporting on any code — e.g. set_aside 8A is '8(a) Competed' while 8AN is '8(a) Sole Source'. Static lookup: no API key, no network.",
        inputSchema: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: `Code domain: one of ${REFERENCE_DOMAINS.join(', ')}`
            },
            code: {
              type: "string",
              description: "The code to look up (e.g. '8AN'). Omit to list every code in the domain."
            }
          },
          required: ["domain"]
        }
      }
    ];
  },

  async callTool(name: string, args: any): Promise<any> {
    if (name !== 'lookup_reference_code') {
      throw new Error(`Unknown reference tool: ${name}`);
    }

    const domain = String(args?.domain ?? '').trim();
    const table = listReferenceCodes(domain);
    if (!table) {
      return {
        error: {
          code: 'bad_request',
          message: `Unknown domain "${domain}". Valid domains: ${REFERENCE_DOMAINS.join(', ')}`,
        },
      };
    }

    if (args?.code === undefined || args?.code === null || args?.code === '') {
      return { domain, codes: table };
    }

    const hit = lookupReferenceCode(domain, String(args.code));
    if (!hit) {
      return {
        error: {
          code: 'not_found',
          message:
            `No ${domain} code "${String(args.code).toUpperCase()}". ` +
            `Valid codes: ${table.map(c => c.code).join(', ')}. ` +
            `Call without \`code\` to list them with descriptions.`,
        },
      };
    }
    return { domain, ...hit };
  },
};
