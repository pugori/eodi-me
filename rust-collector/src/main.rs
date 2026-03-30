// ── Module declarations ───────────────────────────────────────────────────────
mod adaptive;
mod boundary;
mod city;
mod cli;
mod collector;
mod commands;
mod config;
mod database;
mod hexagon;
mod metrics;
mod normalizer;
mod pbf;
mod pipeline;
mod poi;
mod ratelimit;
mod resources;
mod robots;
mod stages;
mod vectordb;

// ── Global allocator ──────────────────────────────────────────────────────────
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    use clap::Parser;
    use tracing::Level;
    use tracing_subscriber::FmtSubscriber;
    use crate::config::Config;
    use crate::database::CityDatabase;

    // ── Logging ───────────────────────────────────────────────────────────────
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    let cli = crate::cli::Cli::parse();
    let no_pause = cli.no_pause;

    let run_result: anyhow::Result<()> = async {
        // ── Config + paths ────────────────────────────────────────────────────
        let config = Config::load(cli.config.as_ref().map(|v| v.as_path()))?;
        let database_path = cli.database.unwrap_or_else(|| config.database.file.clone());
        let output_path   = cli.output.unwrap_or_else(|| config.output.directory.clone());

        // ── Database ──────────────────────────────────────────────────────────
        let db = CityDatabase::new(&database_path).await?;
        db.init().await?;

        // ── Resolve command (auto-mode when run with no arguments) ────────────
        let command = match cli.command {
            Some(cmd) => cmd,
            None => crate::pipeline::auto::run_auto_pipeline(&database_path, &output_path).await?,
        };

        let ctx = crate::commands::AppContext { db, database_path, output_path, config };
        crate::commands::dispatch(command, &ctx).await
    }
    .await;

    maybe_pause_before_exit(no_pause);
    run_result
}

fn maybe_pause_before_exit(no_pause: bool) {
    use std::io::Write;

    if no_pause {
        return;
    }
    if std::env::var("EODI_NO_PAUSE").ok().as_deref() == Some("1") {
        return;
    }

    println!("\n✅ 작업이 완료되었습니다. Enter 키를 누르면 종료됩니다...");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
}
