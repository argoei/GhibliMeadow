using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace GhibliMeadow;

/// <summary>运行时绘制托盘图标，避免依赖外部 .ico 资源。</summary>
internal static class TrayIconFactory
{
    public static Icon Create()
    {
        const int Size = 32;
        using var bmp = new Bitmap(Size, Size);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            // 草地底色
            using (var brush = new LinearGradientBrush(
                       new Rectangle(0, 0, Size, Size),
                       Color.FromArgb(150, 190, 108),
                       Color.FromArgb(64, 104, 44),
                       LinearGradientMode.Vertical))
            {
                g.FillEllipse(brush, 0.5f, 0.5f, Size - 1.5f, Size - 1.5f);
            }

            // 花瓣
            using (var petal = new SolidBrush(Color.FromArgb(255, 252, 246)))
            {
                for (int i = 0; i < 6; i++)
                {
                    double a = i * Math.PI / 3.0;
                    float cx = Size / 2f + (float)Math.Cos(a) * 6.6f;
                    float cy = Size / 2f + (float)Math.Sin(a) * 6.6f;
                    g.FillEllipse(petal, cx - 5.2f, cy - 5.2f, 10.4f, 10.4f);
                }
            }

            // 花心
            using (var core = new SolidBrush(Color.FromArgb(246, 200, 56)))
                g.FillEllipse(core, Size / 2f - 5.2f, Size / 2f - 5.2f, 10.4f, 10.4f);
        }

        var handle = bmp.GetHicon();
        try
        {
            using var tmp = Icon.FromHandle(handle);
            return (Icon)tmp.Clone();
        }
        finally
        {
            Native.DestroyIcon(handle);
        }
    }
}
