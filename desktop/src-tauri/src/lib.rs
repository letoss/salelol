use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveStats {
    champion_name: String,
    kills: i64,
    deaths: i64,
    assists: i64,
    creep_score: i64,
    ward_score: f64,
    game_time_seconds: i64,
    game_mode: Option<String>,
}

fn text(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_string()
}

#[tauri::command]
async fn read_live_stats(riot_id: String) -> Result<Option<LiveStats>, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|error| error.to_string())?;
    let response = match client
        .get("https://127.0.0.1:2999/liveclientdata/allgamedata")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) if error.is_connect() || error.is_timeout() => return Ok(None),
        Err(error) => return Err(format!("No se pudo conectar al cliente local: {error}")),
    };
    if !response.status().is_success() {
        return Ok(None);
    }
    let data: Value = response.json().await.map_err(|error| format!("Respuesta local inválida: {error}"))?;
    let active_id = text(data.get("activePlayer").and_then(|player| player.get("riotId")));
    if active_id.is_empty() {
        return Err("El cliente local no informó el Riot ID del jugador activo.".into());
    }
    if !active_id.eq_ignore_ascii_case(riot_id.trim()) {
        return Err(format!("El cliente está conectado como {active_id}, no como {}.", riot_id.trim()));
    }
    let players = data.get("allPlayers").and_then(Value::as_array).ok_or("La partida no contiene jugadores.")?;
    let player = players.iter().find(|player| text(player.get("riotId")).eq_ignore_ascii_case(riot_id.trim())).ok_or("No encontramos al jugador activo en la partida.")?;
    let scores = player.get("scores").ok_or("La partida todavía no tiene puntuaciones disponibles.")?;
    let game_data = data.get("gameData");
    Ok(Some(LiveStats {
        champion_name: text(player.get("championName")),
        kills: scores.get("kills").and_then(Value::as_i64).unwrap_or(0),
        deaths: scores.get("deaths").and_then(Value::as_i64).unwrap_or(0),
        assists: scores.get("assists").and_then(Value::as_i64).unwrap_or(0),
        creep_score: scores.get("creepScore").and_then(Value::as_i64).unwrap_or(0),
        ward_score: scores.get("wardScore").and_then(Value::as_f64).unwrap_or(0.0),
        game_time_seconds: game_data.and_then(|game| game.get("gameTime")).and_then(Value::as_f64).unwrap_or(0.0).round() as i64,
        game_mode: game_data.and_then(|game| game.get("gameMode")).and_then(Value::as_str).map(str::to_string),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_live_stats])
        .run(tauri::generate_context!())
        .expect("error while running SaleLoL Companion");
}
