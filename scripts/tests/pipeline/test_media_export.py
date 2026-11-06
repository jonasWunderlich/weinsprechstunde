"""Unit-Tests für den Medien-Export (Audio/Video) als Teil von image-export."""
import json
import os
import time

from conftest import make_config, make_jpeg, write_json
from conftest import weinimport as wi


def setup(tmp_path, wine=None, files=("a.mp3", "v.mp4")):
    import_dir = tmp_path / "import"
    import_dir.mkdir()
    make_jpeg(import_dir / "w.jpg")
    for name in files:
        (import_dir / name).write_bytes(b"data-" + name.encode())
    write_json(
        import_dir / "w.json",
        wine or {"name": "W", "image": "w.jpg", "audio": "a.mp3", "video": "v.mp4"},
    )
    config = make_config(
        import_dir=str(import_dir),
        image_export_dir=str(tmp_path / "export" / "images"),
        audio_export_dir=str(tmp_path / "export" / "audio"),
        video_export_dir=str(tmp_path / "export" / "video"),
    )
    return import_dir, config


def test_image_export_copies_audio_and_video_unchanged(tmp_path):
    import_dir, config = setup(tmp_path)
    wi.phase_image_export(config)
    assert (tmp_path / "export/audio/a.mp3").read_bytes() == b"data-a.mp3"
    assert (tmp_path / "export/video/v.mp4").read_bytes() == b"data-v.mp4"
    assert (tmp_path / "export/images/w.jpg").exists()


def test_archive_media_ignored(tmp_path):
    import_dir, config = setup(tmp_path, wine={"name": "W", "image": "w.jpg"})
    arch = import_dir / "_archive"
    arch.mkdir()
    (arch / "x.mp3").write_bytes(b"x")
    (arch / "x.mp4").write_bytes(b"x")
    write_json(arch / "x.json", {"name": "X", "audio": "x.mp3", "video": "x.mp4"})
    wi.phase_image_export(config)
    assert not (tmp_path / "export/audio/x.mp3").exists()
    assert not (tmp_path / "export/video/x.mp4").exists()


def test_missing_media_warns_without_abort(tmp_path, capsys):
    import_dir, config = setup(tmp_path, files=())
    wi.phase_image_export(config)
    err = capsys.readouterr().err
    assert "media-export" in err
    assert "2 Quellen fehlten" in err
    assert not (tmp_path / "export/audio/a.mp3").exists()


def test_up_to_date_media_not_copied_again(tmp_path):
    import_dir, config = setup(tmp_path)
    wi.phase_image_export(config)
    dst = tmp_path / "export/video/v.mp4"
    first = dst.stat().st_mtime
    time.sleep(0.02)
    wi.phase_media_export(config)
    assert dst.stat().st_mtime == first


def test_changed_media_copied_again(tmp_path):
    import_dir, config = setup(tmp_path)
    wi.phase_media_export(config)
    src = import_dir / "a.mp3"
    src.write_bytes(b"longer-new-content")
    os.utime(src, (time.time() + 100, time.time() + 100))
    wi.phase_media_export(config)
    assert (tmp_path / "export/audio/a.mp3").read_bytes() == b"longer-new-content"


def test_media_name_is_flat(tmp_path):
    import_dir, config = setup(tmp_path, wine={"name": "W", "audio": "sub/a.mp3"})
    (import_dir / "sub").mkdir()
    (import_dir / "sub" / "a.mp3").write_bytes(b"s")
    wi.phase_media_export(config)
    assert (tmp_path / "export/audio/a.mp3").exists()


def test_load_config_media_defaults_when_keys_missing(tmp_path):
    cfg = tmp_path / "c.json"
    cfg.write_text(
        json.dumps(
            {
                "import_source": "local",
                "export_path": "./out/wines.json",
                "scaffold_mode": True,
                "image_export_dir": "./export/images",
                "image_resize_mode": "width",
                "image_resize_px": 1200,
                "deploy": {
                    "protocol": "ftpes",
                    "remote_path": "/",
                    "remote_images_path": "/images",
                    "remote_import_path": "/data",
                },
                "editor": {"path": "/e", "password_hash": "x"},
            }
        ),
        encoding="utf-8",
    )
    config = wi.load_config(str(cfg))
    assert config.audio_export_dir == "./export/audio"
    assert config.video_export_dir == "./export/video"
    assert config.deploy.remote_audio_path == "/audio"
    assert config.deploy.remote_video_path == "/video"
