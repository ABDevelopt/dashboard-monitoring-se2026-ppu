const { getDb } = require('d:/SE2026/monitoring-se2026-ppu/database');
const db = getDb();

function testParser(content) {
  console.log('Parsing content:', content);
  const text = content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      let toolName = parsed.tool || parsed.name || parsed.function || parsed.action;
      
      // Implicit tool detection
      if (!toolName) {
        if (parsed.route || parsed.endpoint) {
          toolName = 'fetch_page_data';
        } else if (parsed.query || parsed.sql || parsed.params?.query || parsed.params?.sql || parsed.arguments?.query || parsed.arguments?.sql) {
          toolName = 'run_read_only_query';
        }
      }

      if (toolName === 'run_read_only_query' || toolName === 'fetch_page_data') {
        console.log('✅ Found tool name:', toolName);
        let args = {};
        if (toolName === 'run_read_only_query') {
          const queryVal = parsed.query || parsed.sql || parsed.params?.query || parsed.params?.sql || parsed.arguments?.query || parsed.arguments?.sql || parsed.arguments || parsed.params || '';
          args = { query: typeof queryVal === 'string' ? queryVal : JSON.stringify(queryVal) };
        } else if (toolName === 'fetch_page_data') {
          const routeVal = parsed.route || parsed.endpoint || parsed.params?.route || parsed.params?.endpoint || parsed.arguments?.route || parsed.arguments?.endpoint || '';
          const qParams = parsed.queryParams || parsed.params?.queryParams || parsed.arguments?.queryParams || parsed.params || {};
          args = { route: routeVal, queryParams: typeof qParams === 'object' ? qParams : {} };
        }
        return { name: toolName, args };
      }
    } catch (e) {
      console.error('❌ Failed to parse JSON:', e.message);
    }
  }
  return null;
}

async function main() {
  console.log('--- STARTING FALLBACK PARSER UNIT TESTS ---');

  // Case 1: User's exact output for "berapa jumlah desa di masing-masing kecamatan?"
  const case1 = `{"tool": "run_read_only_query", "params": {"sql": "SELECT kecamatan, COUNT(DISTINCT desa) AS jumlah_desa FROM subsls_master GROUP BY kecamatan ORDER BY kecamatan;", "params": {}}}`;
  const res1 = testParser(case1);
  console.log('Case 1 result:', res1);
  if (res1 && res1.name === 'run_read_only_query') {
    console.log('✅ Case 1 Passed!');
    // Let's run it against the real DB!
    const rows = db.prepare(res1.args.query).all();
    console.log('DB Query Result:', rows);
  } else {
    console.error('❌ Case 1 Failed!');
  }

  // Case 2: User's exact output for "daftar nama desa di kecamatan sepaku"
  console.log('\nTesting Case 2:');
  const case2 = `{"tool": "run_read_only_query", "params": {"sql": "SELECT DISTINCT desa FROM subsls_master WHERE LOWER(kecamatan) = LOWER(\'Sepaku\') ORDER BY desa;", "params": {}}}`;
  const res2 = testParser(case2);
  console.log('Case 2 result:', res2);
  if (res2 && res2.name === 'run_read_only_query') {
    console.log('✅ Case 2 Passed!');
    const rows = db.prepare(res2.args.query).all();
    console.log('DB Query Result (Sepaku villages):', rows);
  } else {
    console.error('❌ Case 2 Failed!');
  }

  // Case 3: Implicit tool call for fetch_page_data '/early-warning'
  console.log('\nTesting Case 3 (Implicit Tool Call):');
  const case3 = `{"route": "/early-warning", "queryParams": {}}`;
  const res3 = testParser(case3);
  console.log('Case 3 result:', res3);
  if (res3 && res3.name === 'fetch_page_data' && res3.args.route === '/early-warning') {
    console.log('✅ Case 3 Passed!');
  } else {
    console.error('❌ Case 3 Failed!');
  }

  // Case 4: Endpoint alias matching
  console.log('\nTesting Case 4 (Endpoint Alias):');
  const case4 = `{"tool": "fetch_page_data", "endpoint": "/pcl", "params": {"sortField": "submitted_total", "sortOrder": "desc", "limit": 10}}`;
  const res4 = testParser(case4);
  console.log('Case 4 result:', res4);
  if (res4 && res4.name === 'fetch_page_data' && res4.args.route === '/pcl' && res4.args.queryParams.limit === 10) {
    console.log('✅ Case 4 Passed!');
  } else {
    console.error('❌ Case 4 Failed!');
  }

  console.log('\n--- ALL UNIT TESTS COMPLETED ---');
}

main().catch(console.error);
