import io

import pytest


def _register(client, username="alice"):
    client.post("/api/auth/register", json={"username": username, "password": "password123"})


def _upload(client, duration=10.0):
    return client.post(
        "/api/recordings",
        files={"file": ("memo.m4a", io.BytesIO(b"fake"), "audio/mp4")},
        data={"duration_seconds": str(duration)},
    ).json()["id"]


def _make_chart(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TABIT_STORAGE_DIR", str(tmp_path))
    _register(client)
    rec_id = _upload(client)
    resp = client.post(f"/api/recordings/{rec_id}/chart", json={"key_tonic": "C", "key_mode": "major"})
    assert resp.status_code == 201
    return rec_id, resp.json()["id"]


def test_create_and_get_chart(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    chart = client.get(f"/api/recordings/{rec_id}/chart").json()
    assert chart["key_tonic"] == "C"
    assert chart["segments"] == []


def test_add_segment_computes_roman_and_seconds(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)  # duration=10.0
    resp = client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 0.0, "end_beat": 4.0, "chord_root": "G", "chord_quality": "dom7"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["roman_numeral"] == "V7"
    # No analysis -> synthesized 120 BPM grid (0.5s/beat): 4 beats == 2.0s.
    assert body["start_time"] == pytest.approx(0.0)
    assert body["end_time"] == pytest.approx(2.0)


def test_add_overlapping_segment_rejected(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    client.post(f"/api/charts/{chart_id}/segments",
                json={"start_beat": 0.0, "end_beat": 4.0, "chord_root": "C", "chord_quality": "maj"})
    resp = client.post(f"/api/charts/{chart_id}/segments",
                       json={"start_beat": 2.0, "end_beat": 6.0, "chord_root": "F", "chord_quality": "maj"})
    assert resp.status_code == 422


def test_segment_beyond_grid_rejected(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)  # duration 10s -> 20 beats
    resp = client.post(f"/api/charts/{chart_id}/segments",
                       json={"start_beat": 0.0, "end_beat": 999.0, "chord_root": "C", "chord_quality": "maj"})
    assert resp.status_code == 422


def test_update_segment_chord(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    seg_id = client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 0.0, "end_beat": 4.0, "chord_root": "C", "chord_quality": "maj"},
    ).json()["id"]
    resp = client.patch(
        f"/api/charts/{chart_id}/segments/{seg_id}",
        json={"chord_root": "A", "chord_quality": "min"},
    )
    assert resp.status_code == 200
    assert resp.json()["roman_numeral"] == "vi"


def test_delete_segment(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    seg_id = client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 0.0, "end_beat": 4.0, "chord_root": "C", "chord_quality": "maj"},
    ).json()["id"]
    assert client.delete(f"/api/charts/{chart_id}/segments/{seg_id}").status_code == 204
    assert client.get(f"/api/recordings/{rec_id}/chart").json()["segments"] == []


@pytest.mark.parametrize(
    "semitones, segments, expected_key, expected_roots, expected_numerals",
    [
        pytest.param(
            2,
            # At synthesized 120 BPM (0.5s/beat): 4 beats = 2s, keep segments non-overlapping
            (("C", 0.0, 4.0, "maj"), ("F", 4.0, 8.0, "maj"), ("G", 8.0, 12.0, "maj")),
            "D",
            ["D", "G", "A"],
            ["I", "IV", "V"],
            id="up-two-sharp-spelling",
        ),
        pytest.param(
            -2,
            (("C", 0.0, 4.0, "maj"), ("A", 4.0, 8.0, "min")),
            "Bb",
            ["Bb", "G"],
            ["I", "vi"],
            id="down-two-flat-spelling",
        ),
    ],
)
def test_transpose_shifts_chords_and_spells_per_target_key(
    client, tmp_path, monkeypatch, semitones, segments, expected_key, expected_roots, expected_numerals
):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)  # C major
    for root, sb, eb, quality in segments:
        client.post(
            f"/api/charts/{chart_id}/segments",
            json={"start_beat": sb, "end_beat": eb, "chord_root": root, "chord_quality": quality},
        )
    resp = client.post(f"/api/charts/{chart_id}/transpose", json={"semitones": semitones})
    assert resp.status_code == 200
    chart = resp.json()
    assert chart["key_tonic"] == expected_key
    assert [s["chord_root"] for s in chart["segments"]] == expected_roots
    assert [s["roman_numeral"] for s in chart["segments"]] == expected_numerals


def test_chart_access_scoped_to_owner(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    client.post("/api/auth/logout")
    _register(client, "intruder")
    assert client.get(f"/api/recordings/{rec_id}/chart").status_code == 404
    assert client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 0.0, "end_beat": 2.0, "chord_root": "C", "chord_quality": "maj"},
    ).status_code == 404


def test_update_chart_settings(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    resp = client.patch(f"/api/charts/{chart_id}/settings",
                        json={"beats_per_measure": 3, "measure_offset": 1})
    assert resp.status_code == 200
    body = resp.json()
    assert body["beats_per_measure"] == 3
    assert body["measure_offset"] == 1


def test_correcting_key_rewrites_numerals_but_not_chords(client, tmp_path, monkeypatch):
    """The mirror image of /transpose: chords stay put, numerals move."""
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)  # C major
    for root, sb, eb in (("C", 0.0, 4.0), ("F", 4.0, 8.0), ("G", 8.0, 12.0)):
        client.post(
            f"/api/charts/{chart_id}/segments",
            json={"start_beat": sb, "end_beat": eb, "chord_root": root, "chord_quality": "maj"},
        )
    resp = client.patch(
        f"/api/charts/{chart_id}/settings", json={"key_tonic": "G", "key_mode": "major"}
    )
    assert resp.status_code == 200
    chart = resp.json()
    assert (chart["key_tonic"], chart["key_mode"]) == ("G", "major")
    assert [s["chord_root"] for s in chart["segments"]] == ["C", "F", "G"]
    assert [s["chord_quality"] for s in chart["segments"]] == ["maj", "maj", "maj"]
    assert [s["roman_numeral"] for s in chart["segments"]] == ["IV", "bVII", "I"]
    # Persisted, not just echoed back.
    assert client.get(f"/api/recordings/{rec_id}/chart").json()["key_tonic"] == "G"


def test_correcting_key_mode_alone_rewrites_numerals(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)  # C major
    client.post(f"/api/charts/{chart_id}/segments",
                json={"start_beat": 0.0, "end_beat": 4.0, "chord_root": "Eb", "chord_quality": "maj"})
    chart = client.patch(f"/api/charts/{chart_id}/settings", json={"key_mode": "minor"}).json()
    assert (chart["key_tonic"], chart["key_mode"]) == ("C", "minor")
    seg = chart["segments"][0]
    assert seg["chord_root"] == "Eb"          # bIII in C major...
    assert seg["roman_numeral"] == "III"      # ...is the diatonic III in C minor


@pytest.mark.parametrize(
    "payload",
    [{"key_tonic": "H"}, {"key_tonic": "Cbb"}, {"key_mode": "dorian"}, {"key_mode": "Major"}],
)
def test_invalid_key_correction_rejected(client, tmp_path, monkeypatch, payload):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    assert client.patch(f"/api/charts/{chart_id}/settings", json=payload).status_code == 422
    assert client.get(f"/api/recordings/{rec_id}/chart").json()["key_tonic"] == "C"


def test_add_segment_on_null_duration_chart(client, db_session, tmp_path, monkeypatch):
    """Segments must be addable even when recording.duration_seconds is NULL (regression)."""
    from sqlalchemy import select as sa_select

    from app.models import Recording

    monkeypatch.setenv("TABIT_STORAGE_DIR", str(tmp_path))
    _register(client)
    rec_id = _upload(client)

    # Simulate a recording whose duration is not yet known.
    rec = db_session.execute(sa_select(Recording).where(Recording.id == rec_id)).scalar_one()
    rec.duration_seconds = None
    db_session.commit()

    resp = client.post(
        f"/api/recordings/{rec_id}/chart", json={"key_tonic": "C", "key_mode": "major"}
    )
    assert resp.status_code == 201
    chart_id = resp.json()["id"]

    resp = client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 0.0, "end_beat": 4.0, "chord_root": "C", "chord_quality": "maj"},
    )
    assert resp.status_code == 201


def _three_segments(client, chart_id):
    ids = []
    for root, sb, eb in (("C", 0.0, 4.0), ("F", 4.0, 8.0), ("G", 8.0, 12.0)):
        ids.append(client.post(
            f"/api/charts/{chart_id}/segments",
            json={"start_beat": sb, "end_beat": eb, "chord_root": root, "chord_quality": "maj"},
        ).json()["id"])
    return ids


def test_batch_resize_applies_redistributed_windows(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)  # duration 10s -> 20 beats
    a, b, c = _three_segments(client, chart_id)
    # Grow A to 6 by taking 2 from B — the single-PATCH path would 422 on overlap.
    resp = client.patch(f"/api/charts/{chart_id}/segments", json={"segments": [
        {"id": a, "start_beat": 0.0, "end_beat": 6.0},
        {"id": b, "start_beat": 6.0, "end_beat": 8.0},
    ]})
    assert resp.status_code == 200
    spans = {s["chord_root"]: (s["start_beat"], s["end_beat"]) for s in resp.json()["segments"]}
    assert spans["C"] == (0.0, 6.0)
    assert spans["F"] == (6.0, 8.0)
    assert spans["G"] == (8.0, 12.0)


def test_batch_resize_rejects_overlapping_final_state_atomically(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    a, b, c = _three_segments(client, chart_id)
    resp = client.patch(f"/api/charts/{chart_id}/segments", json={"segments": [
        {"id": a, "start_beat": 0.0, "end_beat": 6.0},  # overlaps B, which is unchanged
    ]})
    assert resp.status_code == 422
    # Nothing committed.
    spans = {s["chord_root"]: s["end_beat"] for s in client.get(f"/api/recordings/{rec_id}/chart").json()["segments"]}
    assert spans["C"] == 4.0


def test_batch_resize_rejects_beyond_grid(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)  # 20 beats max
    a, b, c = _three_segments(client, chart_id)
    resp = client.patch(f"/api/charts/{chart_id}/segments", json={"segments": [
        {"id": c, "start_beat": 8.0, "end_beat": 999.0},
    ]})
    assert resp.status_code == 422


def test_batch_resize_unknown_segment_404(client, tmp_path, monkeypatch):
    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)
    _three_segments(client, chart_id)
    resp = client.patch(f"/api/charts/{chart_id}/segments", json={"segments": [
        {"id": "nope", "start_beat": 0.0, "end_beat": 2.0},
    ]})
    assert resp.status_code == 404


def _chart_with_grid(client, db_session, tmp_path, monkeypatch, bpm=144, interval=0.418):
    """A chart on a tracked beat grid at `bpm`, the way analysis seeds one."""
    from sqlalchemy import select as sa_select

    from app.models import ChordChart

    rec_id, chart_id = _make_chart(client, monkeypatch, tmp_path)  # duration=10.0
    chart = db_session.execute(
        sa_select(ChordChart).where(ChordChart.id == chart_id)
    ).scalar_one()
    chart.beat_times = [round(i * interval, 6) for i in range(25)]  # 0 .. 10.03s
    chart.bpm = bpm
    db_session.commit()
    return rec_id, chart_id


def test_tempo_halves_beat_counts_without_moving_chords_in_time(
    client, db_session, tmp_path, monkeypatch
):
    """The double-time fix: the engine heard 144 BPM in a 72 BPM song.

    Halving the tempo must re-count each chord — 8 beats becomes 4 — while leaving the audio
    it covers exactly where it was. Beats are the chart's unit; seconds are the ground truth.
    """
    rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)
    client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 0.0, "end_beat": 8.0, "chord_root": "B", "chord_quality": "maj"},
    )
    client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 8.0, "end_beat": 16.0, "chord_root": "F#", "chord_quality": "min"},
    )
    before = client.get(f"/api/recordings/{rec_id}/chart").json()
    times_before = [(s["start_time"], s["end_time"]) for s in before["segments"]]

    resp = client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": 72})
    assert resp.status_code == 200
    after = resp.json()

    assert after["bpm"] == 72
    assert [(s["start_beat"], s["end_beat"]) for s in after["segments"]] == [
        (0.0, 4.0), (4.0, 8.0),
    ]
    assert [s["chord_root"] for s in after["segments"]] == ["B", "F#"]
    # Same audio, half the beats: every chord still covers the seconds it did before.
    times_after = [(s["start_time"], s["end_time"]) for s in after["segments"]]
    for (s0, e0), (s1, e1) in zip(times_before, times_after):
        assert s1 == pytest.approx(s0, abs=0.02)
        assert e1 == pytest.approx(e0, abs=0.02)
    # The grid keeps the tracked onsets it had, one beat where there were two.
    assert after["beat_times"] == pytest.approx(before["beat_times"][::2])


def test_tempo_doubling_is_the_inverse_of_halving(client, db_session, tmp_path, monkeypatch):
    rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)
    client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 0.0, "end_beat": 4.0, "chord_root": "B", "chord_quality": "maj"},
    )
    client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": 72})
    resp = client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": 144})

    assert resp.status_code == 200
    assert resp.json()["bpm"] == 144
    seg = resp.json()["segments"][0]
    assert (seg["start_beat"], seg["end_beat"]) == (0.0, 4.0)


def test_tempo_persists_and_is_returned_by_get_chart(client, db_session, tmp_path, monkeypatch):
    rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)
    client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": 90})
    assert client.get(f"/api/recordings/{rec_id}/chart").json()["bpm"] == 90


def test_tempo_is_stored_and_returned_as_a_whole_number(
    client, db_session, tmp_path, monkeypatch
):
    # A tempo is a count, not a measurement: a fractional request is rounded, not rejected,
    # and what comes back is what the player will read off the chart.
    rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)
    resp = client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": 71.8})

    assert resp.status_code == 200
    assert resp.json()["bpm"] == 72
    assert client.get(f"/api/recordings/{rec_id}/chart").json()["bpm"] == 72


def test_a_chart_analysed_before_whole_tempos_reads_back_whole(
    client, db_session, tmp_path, monkeypatch
):
    # Charts already in the database carry the tracker's raw estimate. They must not show
    # 143.6 BPM, and a halving from one must land on the tempo we showed: 144 -> 72.
    rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch, bpm=143.6)
    before = client.get(f"/api/recordings/{rec_id}/chart").json()
    assert before["bpm"] == 144

    after = client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": 72}).json()
    assert after["bpm"] == 72
    # 72/144 is an exact halving, so the grid keeps every second tracked onset. Had the
    # rescale divided by the stored 143.6 the factor would have drifted off the beat.
    assert after["beat_times"] == pytest.approx(before["beat_times"][::2])


def test_tempo_keeps_segments_inside_the_recording(client, db_session, tmp_path, monkeypatch):
    # The chart-never-exceeds-the-recording invariant has to survive a tempo change.
    rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)
    chart = client.get(f"/api/recordings/{rec_id}/chart").json()
    end = max(s["end_beat"] for s in chart["segments"]) if chart["segments"] else 0
    client.post(
        f"/api/charts/{chart_id}/segments",
        json={"start_beat": 0.0, "end_beat": 20.0, "chord_root": "B", "chord_quality": "maj"},
    )
    after = client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": 288}).json()
    for seg in after["segments"]:
        assert seg["end_time"] <= 10.0 + 1e-6  # the recording is 10s long
    assert end == 0


@pytest.mark.parametrize("bpm", [0, -10, 20, 20.4, 401, 400.6])
def test_tempo_rejects_implausible_values(client, db_session, tmp_path, monkeypatch, bpm):
    # Rounding happens before the range check, so 20.4 (-> 20) and 400.6 (-> 401) are out.
    _rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)
    assert client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": bpm}).status_code == 422


def test_tempo_on_another_users_chart_is_404(client, db_session, tmp_path, monkeypatch):
    _rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)
    client.post("/api/auth/logout")
    _register(client, "mallory")
    assert client.patch(
        f"/api/charts/{chart_id}/tempo", json={"bpm": 90}
    ).status_code == 404


def test_library_listing_carries_the_edited_tempo_and_key(
    client, db_session, tmp_path, monkeypatch
):
    """Correcting a chart has to change how the song reads in the library.

    The library lists each song's tempo and key. `Analysis` is immutable, so once the player
    has re-counted a double-time tempo or fixed a misheard key, only the chart knows what
    the song is — the listing has to carry those values, not the engine's first guess.
    """
    from sqlalchemy import select as sa_select

    from app.models import Analysis

    rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)  # 144 BPM
    analysis = db_session.execute(
        sa_select(Analysis).where(Analysis.recording_id == rec_id)
    ).scalar_one()
    analysis.status = "done"
    analysis.bpm = 144
    analysis.detected_key_tonic = "C"
    analysis.detected_key_mode = "major"
    db_session.commit()

    client.patch(f"/api/charts/{chart_id}/tempo", json={"bpm": 72})
    client.patch(f"/api/charts/{chart_id}/settings", json={"key_tonic": "A", "key_mode": "minor"})

    row = next(r for r in client.get("/api/recordings").json() if r["id"] == rec_id)
    assert row["chart"]["bpm"] == 72
    assert (row["chart"]["key_tonic"], row["chart"]["key_mode"]) == ("A", "minor")
    # The engine's record of what it heard is untouched by the correction.
    assert row["analysis"]["bpm"] == 144
    assert row["analysis"]["detected_key_tonic"] == "C"
    assert row["analysis"]["detected_key_mode"] == "major"


def test_library_listing_carries_a_transposed_key(client, db_session, tmp_path, monkeypatch):
    rec_id, chart_id = _chart_with_grid(client, db_session, tmp_path, monkeypatch)  # key of C
    client.post(f"/api/charts/{chart_id}/transpose", json={"semitones": 2})

    row = next(r for r in client.get("/api/recordings").json() if r["id"] == rec_id)
    assert row["chart"]["key_tonic"] == "D"
