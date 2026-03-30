import duckdb

con = duckdb.connect('cities.db')
try:
    table_count = con.execute(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='climate_cells'"
    ).fetchone()[0]
    cols = [r[1] for r in con.execute("PRAGMA table_info('cities')").fetchall()]
    print('climate_cells_table', table_count)
    print('has_climate_cell_id', 'climate_cell_id' in cols)
    print('has_climate_confidence', 'climate_confidence' in cols)
finally:
    con.close()
