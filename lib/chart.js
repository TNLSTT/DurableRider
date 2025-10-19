import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { Chart, registerables } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

Chart.register(...registerables, annotationPlugin);

let s3Client = null;
if (process.env.AWS_REGION && process.env.S3_BUCKET_NAME) {
  s3Client = new S3Client({ region: process.env.AWS_REGION });
}

const width = 800;
const height = 600;
const chartJSNodeCanvas = new ChartJSNodeCanvas({
  width,
  height,
  backgroundColour: 'white',
});

async function uploadToS3(buffer, contentType) {
  if (!s3Client) {
    return null;
  }
  const bucket = process.env.S3_BUCKET_NAME;
  const key = `durability/${crypto.randomUUID()}.png`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    }),
  );
  const baseUrl = process.env.S3_PUBLIC_BASE_URL ?? `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com`;
  return `${baseUrl}/${key}`;
}

export async function generateWattsHrChart({ time, watts, heartrate, segments }) {
  if (!time || !watts || !heartrate || time.length === 0) {
    return null;
  }

  const labels = time.map((value) => (value / 60).toFixed(1));

  const configuration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Watts',
          data: watts,
          borderColor: 'rgba(255, 99, 132, 0.8)',
          yAxisID: 'y1',
          tension: 0.2,
          pointRadius: 0,
        },
        {
          label: 'Heart Rate',
          data: heartrate,
          borderColor: 'rgba(54, 162, 235, 0.8)',
          yAxisID: 'y2',
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: 'Watts vs Heart Rate (Early vs Late)' },
      },
      scales: {
        y1: { type: 'linear', position: 'left', title: { display: true, text: 'Watts' } },
        y2: { type: 'linear', position: 'right', title: { display: true, text: 'Heart Rate (bpm)' } },
      },
    },
  };

  if (segments?.early && segments?.late) {
    configuration.options.plugins.annotation = {
      annotations: {
        early: {
          type: 'box',
          xMin: segments.early[0],
          xMax: segments.early[1],
          backgroundColor: 'rgba(0, 255, 0, 0.05)',
        },
        late: {
          type: 'box',
          xMin: segments.late[0],
          xMax: segments.late[1],
          backgroundColor: 'rgba(255, 165, 0, 0.05)',
        },
      },
    };
  }

  const buffer = await chartJSNodeCanvas.renderToBuffer(configuration, 'image/png');
  return uploadToS3(buffer, 'image/png');
}
