/**
 * Tests for FileIcon utility - File type categorization
 */

const { getFileCategory } = require('../src/renderer/components/ui/FileIcon');

describe('FileIcon utilities', () => {
  describe('getFileCategory', () => {
    describe('Document types', () => {
      test('categorizes PDF as Documents', () => {
        expect(getFileCategory('report.pdf')).toBe('Documents');
      });

      test('categorizes DOC as Documents', () => {
        expect(getFileCategory('letter.doc')).toBe('Documents');
      });

      test('categorizes DOCX as Documents', () => {
        expect(getFileCategory('resume.docx')).toBe('Documents');
      });

      test('categorizes TXT as Documents', () => {
        expect(getFileCategory('notes.txt')).toBe('Documents');
      });

      test('categorizes RTF as Documents', () => {
        expect(getFileCategory('memo.rtf')).toBe('Documents');
      });

      test('categorizes MD as Documents', () => {
        expect(getFileCategory('README.md')).toBe('Documents');
      });

      test('categorizes ODT as Documents', () => {
        expect(getFileCategory('document.odt')).toBe('Documents');
      });
    });

    describe('Spreadsheet types', () => {
      test('categorizes XLS as Spreadsheets', () => {
        expect(getFileCategory('budget.xls')).toBe('Spreadsheets');
      });

      test('categorizes XLSX as Spreadsheets', () => {
        expect(getFileCategory('data.xlsx')).toBe('Spreadsheets');
      });

      test('categorizes CSV as Spreadsheets', () => {
        expect(getFileCategory('export.csv')).toBe('Spreadsheets');
      });

      test('categorizes ODS as Spreadsheets', () => {
        expect(getFileCategory('sheet.ods')).toBe('Spreadsheets');
      });
    });

    describe('Presentation types', () => {
      test('categorizes PPT as Presentations', () => {
        expect(getFileCategory('slides.ppt')).toBe('Presentations');
      });

      test('categorizes PPTX as Presentations', () => {
        expect(getFileCategory('presentation.pptx')).toBe('Presentations');
      });

      test('categorizes ODP as Presentations', () => {
        expect(getFileCategory('deck.odp')).toBe('Presentations');
      });
    });

    describe('Image types', () => {
      test('categorizes JPG as Images', () => {
        expect(getFileCategory('photo.jpg')).toBe('Images');
      });

      test('categorizes JPEG as Images', () => {
        expect(getFileCategory('image.jpeg')).toBe('Images');
      });

      test('categorizes PNG as Images', () => {
        expect(getFileCategory('screenshot.png')).toBe('Images');
      });

      test('categorizes GIF as Images', () => {
        expect(getFileCategory('animation.gif')).toBe('Images');
      });

      test('categorizes SVG as Images', () => {
        expect(getFileCategory('icon.svg')).toBe('Images');
      });

      test('categorizes WEBP as Images', () => {
        expect(getFileCategory('modern.webp')).toBe('Images');
      });

      test('categorizes BMP as Images', () => {
        expect(getFileCategory('old.bmp')).toBe('Images');
      });

      test('categorizes ICO as Images', () => {
        expect(getFileCategory('favicon.ico')).toBe('Images');
      });

      test('categorizes TIFF as Images', () => {
        expect(getFileCategory('scan.tiff')).toBe('Images');
      });

      test('categorizes HEIC as Images', () => {
        expect(getFileCategory('iphone.heic')).toBe('Images');
      });
    });

    describe('Video types', () => {
      test('categorizes MP4 as Videos', () => {
        expect(getFileCategory('movie.mp4')).toBe('Videos');
      });

      test('categorizes MOV as Videos', () => {
        expect(getFileCategory('clip.mov')).toBe('Videos');
      });

      test('categorizes AVI as Videos', () => {
        expect(getFileCategory('video.avi')).toBe('Videos');
      });

      test('categorizes MKV as Videos', () => {
        expect(getFileCategory('film.mkv')).toBe('Videos');
      });

      test('categorizes WEBM as Videos', () => {
        expect(getFileCategory('web.webm')).toBe('Videos');
      });

      test('categorizes WMV as Videos', () => {
        expect(getFileCategory('windows.wmv')).toBe('Videos');
      });
    });

    describe('Audio types', () => {
      test('categorizes MP3 as Audio', () => {
        expect(getFileCategory('song.mp3')).toBe('Audio');
      });

      test('categorizes WAV as Audio', () => {
        expect(getFileCategory('sound.wav')).toBe('Audio');
      });

      test('categorizes FLAC as Audio', () => {
        expect(getFileCategory('lossless.flac')).toBe('Audio');
      });

      test('categorizes AAC as Audio', () => {
        expect(getFileCategory('audio.aac')).toBe('Audio');
      });

      test('categorizes OGG as Audio', () => {
        expect(getFileCategory('track.ogg')).toBe('Audio');
      });

      test('categorizes M4A as Audio', () => {
        expect(getFileCategory('itunes.m4a')).toBe('Audio');
      });
    });

    describe('Code types', () => {
      test('categorizes JS as Code', () => {
        expect(getFileCategory('app.js')).toBe('Code');
      });

      test('categorizes JSX as Code', () => {
        expect(getFileCategory('Component.jsx')).toBe('Code');
      });

      test('categorizes TS as Code', () => {
        expect(getFileCategory('types.ts')).toBe('Code');
      });

      test('categorizes TSX as Code', () => {
        expect(getFileCategory('App.tsx')).toBe('Code');
      });

      test('categorizes PY as Code', () => {
        expect(getFileCategory('script.py')).toBe('Code');
      });

      test('categorizes JAVA as Code', () => {
        expect(getFileCategory('Main.java')).toBe('Code');
      });

      test('categorizes CPP as Code', () => {
        expect(getFileCategory('program.cpp')).toBe('Code');
      });

      test('categorizes C as Code', () => {
        expect(getFileCategory('main.c')).toBe('Code');
      });

      test('categorizes H as Code', () => {
        expect(getFileCategory('header.h')).toBe('Code');
      });

      test('categorizes HTML as Code', () => {
        expect(getFileCategory('index.html')).toBe('Code');
      });

      test('categorizes CSS as Code', () => {
        expect(getFileCategory('styles.css')).toBe('Code');
      });

      test('categorizes SCSS as Code', () => {
        expect(getFileCategory('theme.scss')).toBe('Code');
      });

      test('categorizes SQL as Code', () => {
        expect(getFileCategory('query.sql')).toBe('Code');
      });

      test('categorizes SH as Code', () => {
        expect(getFileCategory('build.sh')).toBe('Code');
      });

      test('categorizes GO as Code', () => {
        expect(getFileCategory('main.go')).toBe('Code');
      });

      test('categorizes RS as Code', () => {
        expect(getFileCategory('lib.rs')).toBe('Code');
      });

      test('categorizes RB as Code', () => {
        expect(getFileCategory('app.rb')).toBe('Code');
      });

      test('categorizes PHP as Code', () => {
        expect(getFileCategory('index.php')).toBe('Code');
      });

      test('categorizes SWIFT as Code', () => {
        expect(getFileCategory('ViewController.swift')).toBe('Code');
      });

      test('categorizes KT as Code', () => {
        expect(getFileCategory('MainActivity.kt')).toBe('Code');
      });
    });

    describe('Data types', () => {
      test('categorizes JSON as Data', () => {
        expect(getFileCategory('config.json')).toBe('Data');
      });

      test('categorizes XML as Data', () => {
        expect(getFileCategory('data.xml')).toBe('Data');
      });

      test('categorizes YAML as Data', () => {
        expect(getFileCategory('docker-compose.yaml')).toBe('Data');
      });

      test('categorizes YML as Data', () => {
        expect(getFileCategory('config.yml')).toBe('Data');
      });
    });

    describe('Archive types', () => {
      test('categorizes ZIP as Archives', () => {
        expect(getFileCategory('files.zip')).toBe('Archives');
      });

      test('categorizes RAR as Archives', () => {
        expect(getFileCategory('backup.rar')).toBe('Archives');
      });

      test('categorizes 7Z as Archives', () => {
        expect(getFileCategory('compressed.7z')).toBe('Archives');
      });

      test('categorizes TAR as Archives', () => {
        expect(getFileCategory('archive.tar')).toBe('Archives');
      });

      test('categorizes GZ as Archives', () => {
        expect(getFileCategory('file.gz')).toBe('Archives');
      });
    });

    describe('Unknown/Other types', () => {
      test('categorizes unknown extension as Other', () => {
        expect(getFileCategory('file.xyz')).toBe('Other');
      });

      test('categorizes file without extension as Other', () => {
        expect(getFileCategory('Makefile')).toBe('Other');
      });

      test('handles empty filename', () => {
        expect(getFileCategory('')).toBe('Other');
      });

      test('handles null filename', () => {
        expect(getFileCategory(null)).toBe('Other');
      });

      test('handles undefined filename', () => {
        expect(getFileCategory(undefined)).toBe('Other');
      });
    });

    describe('Case insensitivity', () => {
      test('handles uppercase extensions', () => {
        expect(getFileCategory('DOCUMENT.PDF')).toBe('Documents');
      });

      test('handles mixed case extensions', () => {
        expect(getFileCategory('Photo.JpG')).toBe('Images');
      });
    });

    describe('Path handling', () => {
      test('extracts extension from full path', () => {
        expect(getFileCategory('/users/docs/report.pdf')).toBe('Documents');
      });

      test('extracts extension from Windows path', () => {
        expect(getFileCategory('C:\\Users\\Documents\\file.xlsx')).toBe('Spreadsheets');
      });

      test('handles filename with multiple dots', () => {
        expect(getFileCategory('file.backup.2024.pdf')).toBe('Documents');
      });
    });
  });
});
